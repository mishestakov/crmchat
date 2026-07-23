// Лиды проекта: прогресс-список (/leads), канбан-перемещение и удаление
// айтемов, точечный skip/unskip и ручная пиналка на лиде.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  channels,
  contacts,
  outreachAccounts,
  projectItems,
  scheduledMessages,
  scheduledMessageStatus,
  tgChats,
  tgUsers,
  type ProjectStage,
} from "../../db/schema.ts";
import { emitProjectChanged } from "../../lib/events.ts";
import {
  myAccountIdsSql,
  workspaceAccountIdsSql,
} from "../../lib/outreach-access.ts";
import { channelIsRknSql, channelRknBlockedSql } from "../../lib/rkn-registry.ts";
import {
  fetchPlatformActivity,
  PlatformActivitySchema,
} from "../../lib/platform-active.ts";
import { contactReadySql } from "../../lib/contact-sql.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import {
  armLeadDunning,
  disarmLeadDunning,
  isRknProbeEnabled,
  resolveStickyByTgUserIds,
  scheduleUnscheduledLeads,
} from "../../lib/project-scheduling.ts";
import { ChannelRelationStatusSchema } from "@repo/core";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { nextStepSql } from "../contacts/index.ts";
import { WsProjectParam } from "./shared.ts";

const MoveItemBody = z
  .object({
    // null валиден — «убрать из канбана» (вернуться в «Без стадии»).
    stageId: z.string().min(1).max(64).nullable(),
  })
  .openapi("MoveProjectItem");

// Расширенный progress: на каждое сообщение sequence у лида либо одно
// scheduled_messages-row (одна попытка), либо ничего (msg ещё не запланирован).
// status: pending → sent → (read), либо failed/cancelled.
const LeadMessageProgressSchema = z
  .object({
    messageIdx: z.number().int(),
    // Заход пиналки (0 — холодный авто-догон; ручной взвод пишет 1,2…). Бейдж и
    // «серия отстреляла» считаются по последнему раунду (§1.2 bd-autodogon).
    dunningRound: z.number().int(),
    status: z.enum(scheduledMessageStatus.enumValues),
    sentAt: z.iso.datetime().nullable(),
    readAt: z.iso.datetime().nullable(),
    scheduledAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  })
  .openapi("OutreachLeadMessageProgress");

const LeadAccountSchema = z
  .object({
    id: z.string(),
    firstName: z.string().nullable(),
    tgUsername: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    hasPremium: z.boolean(),
  })
  .openapi("OutreachLeadAccount");

// Состояние лида для триажа списка — единый источник правды, фронт только
// группирует в корзины (нужно действие / в работе / не отправляем). Дефолт —
// needs_review (нужно действие): всё, что не попало в явное «система работает»
// (in_flight) или явный терминал (excluded/blocked_rkn),
// поднимаем человеку, а не хороним в «не отправляем» и не прячем в «в работе».
// «Уже работает на платформе» НЕ гейтим (CPC/CPA-сигнал ненадёжен: админ мог
// смениться, у одного админа часть каналов активна) — это бейдж на лиде,
// менеджер решает сам (channel.platformActivity).
const OUTREACH_STATES = [
  "replied", // ответил — живёт на канбане, не в триаже списка
  "excluded", // менеджер исключил вручную (терминал) → не отправляем
  "blocked_rkn", // >10k и не в реестре РКН (авто-терминал) → не отправляем
  "no_contact", // нет годного контакта → нужно действие (резолвер)
  "bot_manual", // админ-бот → нужно действие (открыть + Запустить бота)
  "not_private", // контакт — канал/группа, не private user → нужно действие (заменить)
  "manual_method", // способ = личка канала/группа: авто-опенера нет, слать вручную
  "not_scheduled", // годен, но scheduled-строк нет → нужно действие (Дослать)
  "in_flight", // система работает: ушло/ждём, догон в очереди (без фейлов)
  "needs_review", // всё прочее (фейл доставки/непредвиденное) → нужно действие (разобраться)
] as const;
type OutreachState = (typeof OUTREACH_STATES)[number];

function deriveOutreachState(l: {
  repliedAt: Date | null;
  skippedAt: Date | null;
  contactReady: boolean | null;
  channelRknBlocked: boolean | null;
  // Проект-уровень: задан проверочный опенер (opener.rknText) → сегмент «нет РКН»
  // перестаёт быть терминалом, лид течёт по обычной оси (планируется/in_flight).
  rknProbe: boolean;
  adminIsBot: boolean | null;
  contactMethodKind: string | null;
  messages: { status: string; error: string | null }[];
}): OutreachState {
  if (l.repliedAt) return "replied";
  if (l.skippedAt) return "excluded";
  if (l.channelRknBlocked && !l.rknProbe) return "blocked_rkn";
  if (!l.contactReady) return "no_contact";
  // Способ связи — личка канала/группа: получателя-человека нет (обнулён в
  // set-admin → clearPlacementRecipients), авто-опенер по нему не уходит.
  // Отдельное состояние, чтобы не маскировалось под not_scheduled/in_flight
  // («в работе», хотя система сама не пошлёт) — слать вручную через панель.
  if (
    l.contactMethodKind === "channel_dm" ||
    l.contactMethodKind === "group" ||
    // Внешний способ (нет адаптера): авто-опенера нет, ведём вручную.
    l.contactMethodKind === "external"
  )
    return "manual_method";

  const failedErrors = l.messages
    .filter((m) => m.status === "failed")
    .map((m) => m.error ?? "");
  const botFailed = failedErrors.some((e) => /BOT_SKIPPED/i.test(e));
  const notPrivateFailed = failedErrors.some((e) => /NOT_PRIVATE/i.test(e));

  if (l.adminIsBot || botFailed) return "bot_manual";
  if (notPrivateFailed) return "not_private";
  if (l.messages.length === 0) return "not_scheduled";

  const hasFailed = failedErrors.length > 0;
  const hasLive = l.messages.some(
    (m) => m.status === "pending" || m.status === "sent",
  );
  // Чистый in-flight: система работает, фейлов в цепочке нет.
  if (!hasFailed && hasLive) return "in_flight";

  // Permanent-фейл доставки (privacy/blocked/deactivated), частично упавшая
  // цепочка, непредвиденное на масштабе — человеку на разбор, не авто-терминал.
  return "needs_review";
}

const LeadProgressSchema = z
  .object({
    id: z.string(),
    username: z.string().nullable(),
    // tg_user_id зафиксирован после первой отправки worker'а (или из
    // pre-resolve sticky на импорте, если контакт был в базе). Нужен на
    // фронте для quick send'а лиду, у которого ещё нет привязанного контакта.
    tgUserId: z.string().nullable(),
    // CSV-properties (для toggle «Показать CSV-данные» в leads-таблице).
    // Сюда уезжают и raw CSV-headers, и mapped-keys.
    properties: z.record(z.string(), z.string()),
    // Аккаунт, через который отправляются сообщения этому лиду. Может быть
    // разным для разных лидов (round-robin distribution при активации).
    // null если sequence ещё в draft и лид незнаком (без sticky).
    account: LeadAccountSchema.nullable(),
    // Откуда приехал account: "scheduled" — фактический accountId зафиксирован
    // в scheduled_messages (sequence уже активирована); "sticky" — предсказание
    // через contacts.primary_account_id, sequence ещё в draft и round-robin
    // этот лид не зацепит; null — лид незнаком, на активации уйдёт в RR.
    accountSource: z.enum(["scheduled", "sticky"]).nullable(),
    // Прогресс по фактическим отправкам лида (опенер + пинги пиналки) из
    // scheduled_messages: messageIdx=0 — опенер, ≥1 — пинги.
    messages: z.array(LeadMessageProgressSchema),
    repliedAt: z.iso.datetime().nullable(),
    // «Уже общались» с этим админом-контактом — справочный сигнал (не гейт):
    // прочитать прошлую переписку перед новым опенером и, возможно, написать
    // иначе. Cross-project: считается по tg_chats пира (peerUserId) через
    // аккаунты воркспейса, а не по текущему проекту — то есть загорится и если
    // общались в другом проекте/у другого клиента. talked = мы когда-либо ему
    // писали (lastOutboundAt); replied = он хоть раз ответил (has_inbound). null
    // — у лида нет tgUserId (MAX/stub без @). Фронт: replied→«был диалог»,
    // talked && !replied→«писали, тишина».
    contactHistory: z
      .object({ talked: z.boolean(), replied: z.boolean() })
      .nullable(),
    // Последнее сообщение в диалоге (любой стороны) — с привязанного контакта.
    // Для подсветки «жёлтый» (§1.4 bd-autodogon): застой считается от последней
    // активности в треде, чтобы ловить и «он молчит нам», и «он написал, а мы
    // сутки не отвечаем». null для лидов без contactId — там застой считается по
    // нашим sentAt из messages[].
    lastMessageAt: z.iso.datetime().nullable(),
    contactId: z.string().nullable(),
    // Непрочитанные входящие — счётчик с прицепленного контакта (если есть).
    // Для лидов без contactId всегда 0. Бэйдж на канбане; синхронизация через
    // contact-stream SSE — листенер на /kanban апдейтит лидов с этим contactId.
    unreadCount: z.number().int(),
    // Ручная пометка «непрочитано» с контакта (chat-level флаг TG) — бэйдж-
    // точка на канбане при unreadCount=0.
    markedUnread: z.boolean(),
    // Ближайший открытый reminder контакта. Рендерится на канбан-карточке как
    // Bell-иконка + дата (Сегодня / DD.MM, красным если просрочен). Берётся
    // через nextStepSql subquery с привязанного contact'а; для лидов без
    // contactId всегда null.
    nextStep: z
      .object({
        date: z.iso.datetime(),
        text: z.string(),
        repeat: z.enum(["none", "daily", "weekly", "monthly"]),
      })
      .nullable(),
    // Текущая стадия канбана (id из project.stages[*].id). null = «без
    // стадии» — карточка не на канбане.
    stageId: z.string().nullable(),
    // Готов ли канал к рассылке — тот же предикат, что гейт /activate
    // (contactReadySql). Фильтр/подсветка «без контакта» в draft-списке.
    contactReady: z.boolean(),
    // Исключён из авто-рассылки (POST /items/{id}/skip). Бейдж + «Вернуть».
    skippedAt: z.iso.datetime().nullable(),
    // Состояние для триажа списка (см. deriveOutreachState). Фронт группирует
    // в корзины: нужно действие / в работе / не отправляем.
    outreachState: z.enum(OUTREACH_STATES),
    // Канал размещения — получатель аутрича резолвится от его админа. null
    // быть не должно (айтем = placement), но left-join → nullable.
    channel: z
      .object({
        id: z.string(),
        title: z.string(),
        username: z.string().nullable(),
        link: z.string().nullable(),
        platform: z.string(),
        // РКН-индикация в списках лидов: memberCount > 10k и !isRkn —
        // красная тревога «Нет РКН».
        memberCount: z.number().int().nullable(),
        isRkn: z.boolean(),
        // Активность канала на рекл-платформах Яндекса (CPC/CPA): источники,
        // свежесть постов, здоровье. null — не нашли. Информ-сигнал для бейджа
        // (работает/простаивает/проблема + тултип), НЕ гейт.
        platformActivity: PlatformActivitySchema.nullable(),
        // Глобальный статус взаимодействия по каналу — для бейджа на карточке
        // доски. Лента истории доске не нужна (она в сайдбаре, из Contact).
        relationStatus: ChannelRelationStatusSchema,
        // Авто-детект нашёл другого админа канала, чем текущий получатель
        // размещения. Не null → маркер «админ сменился → перевести на @X»
        // (клик = set-admin по этому @). Гасится при осознанном set-admin.
        suggestedAdmin: z.string().nullable(),
      })
      .nullable(),
    // Явно выбранный способ связи (set-admin). Для external — свободный label +
    // опц. ссылка: карточка рисует бейдж «нет адаптера», клик по ссылке. null —
    // способ не задан (обычный человек-получатель).
    contactMethod: z
      .object({
        kind: z.string(),
        label: z.string().nullable(),
        link: z.string().nullable(),
      })
      .nullable(),
  })
  .openapi("OutreachLeadProgress");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/leads",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number().int(),
              repliedCount: z.number().int(),
              leads: z.array(LeadProgressSchema),
            }),
          },
        },
        description: "Leads with progress",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");
    const project = await assertProjectAccess(projectId, wsId, userId, role);

    // Фильтр лидов внутри проекта: admin видит всё, member — только лиды,
    // у которых scheduled_messages.account_id ∈ его аккаунтов. Draft-проекты
    // (без scheduled) member'у пустые — это OK: настройку ведёт admin, member
    // включается после активации, когда лиды распределены.
    const memberFilter =
      role === "admin"
        ? undefined
        : sql`EXISTS (
            SELECT 1 FROM scheduled_messages sm
            WHERE sm.item_id = ${projectItems.id}
              AND sm.account_id IN ${myAccountIdsSql(wsId, userId)}
          )`;

    // Агрегаты + leadRows независимы — параллелим. repliedCount по всему
    // списку (не пагинированному) — для шапки «N ответили из M».
    const [repliedCount, leadRows] =
      await Promise.all([
      db.$count(
        projectItems,
        and(
          eq(projectItems.projectId, project.id),
          isNotNull(projectItems.repliedAt),
          memberFilter,
        ),
      ),
      db
        .select({
          id: projectItems.id,
          username: projectItems.username,
          tgUserId: projectItems.tgUserId,
          properties: projectItems.properties,
          repliedAt: projectItems.repliedAt,
          contactId: projectItems.contactId,
          unreadCount: sql<number>`coalesce(${contacts.unreadCount}, 0)::int`,
          markedUnread: sql<boolean>`coalesce(${contacts.markedUnread}, false)`,
          // «Последнее сообщение в треде» в ЛЮБУЮ сторону — для подсветки застоя
          // («затихло N дней»). contacts.last_message_at двигается только на
          // входящем (его семантику менять нельзя — scheduling берёт его как
          // «последний ответ»), поэтому наше исходящее (включая РУЧНОЕ из чата)
          // подмешиваем из tg_chats: max(last_message_at, last_outbound_at) по
          // всем нашим аккаунтам, общавшимся с этим пиром. greatest игнорит NULL.
          // TODO(multi-member): входящее тут воркспейс-глобальное, а исходящее
          // скоупится к аккаунтам смотрящего (myAccountIdsSql). Пока tenancy
          // single-owner — это одно и то же. Когда появятся роли/мемберы, админ,
          // смотрящий лид мембера, не увидит исходящее мембера → ложное «затихло».
          // Тогда скоупить субквери на аккаунты ВОРКСПЕЙСА, а не смотрящего.
          // .mapWith(contacts.lastMessageAt): drizzle применяет timestamp-декодер
          // (строка драйвера → Date) только к КОЛОНКАМ, к сырому sql-выражению —
          // нет. Без этого greatest(...) приходит строкой и .toISOString() ниже
          // падает 500. Переиспользуем декодер самой колонки.
          lastMessageAt: sql<Date | null>`greatest(
            ${contacts.lastMessageAt},
            (select max(greatest(${tgChats.lastMessageAt}, ${tgChats.lastOutboundAt}))
             from ${tgChats}
             where ${tgChats.peerUserId} = ${projectItems.tgUserId}
               and ${tgChats.accountId} in ${myAccountIdsSql(wsId, userId)})
          )`.mapWith(contacts.lastMessageAt),
          // «Уже общались» — cross-project сигнал по пиру (tg_chats). Скоуп —
          // ВЕСЬ workspace (workspaceAccountIdsSql), а НЕ myAccountIdsSql как у
          // lastMessageAt выше: это командный сигнал «кто-либо из нас уже писал
          // этому контакту», совпадает с joinAdmins в channels.ts. При
          // single-owner скоупы идентичны; расходятся при делегациях/мультиюзере,
          // и тогда правильно видеть переписку коллег (иначе шлём второй холодный
          // опенер уже прогретому контакту). talked/replied — раздельные exists,
          // чтобы различать тир «писали, тишина» и «был диалог» (joinAdmins берёт
          // только has_inbound).
          alreadyTalked: sql<boolean>`exists (
            select 1 from ${tgChats}
            where ${tgChats.peerUserId} = ${projectItems.tgUserId}
              and ${tgChats.accountId} in ${workspaceAccountIdsSql(wsId)}
              and ${tgChats.lastOutboundAt} is not null)`,
          alreadyReplied: sql<boolean>`exists (
            select 1 from ${tgChats}
            where ${tgChats.peerUserId} = ${projectItems.tgUserId}
              and ${tgChats.accountId} in ${workspaceAccountIdsSql(wsId)}
              and ${tgChats.hasInbound} = true)`,
          nextStep: nextStepSql,
          stageId: projectItems.stageId,
          skippedAt: projectItems.skippedAt,
          channelId: channels.id,
          channelTitle: channels.title,
          channelUsername: channels.username,
          channelLink: channels.link,
          channelPlatform: channels.platform,
          channelMemberCount: channels.memberCount,
          channelRelationStatus: channels.relationStatus,
          channelIsRkn: channelIsRknSql,
          channelRknBlocked: channelRknBlockedSql,
          // Кандидат смены админа: авто-детект нашёл на канале ДРУГОГО админа,
          // чем текущий получатель размещения (см. channels.ts import guard).
          // Не пустой → на карточке маркер «админ сменился → перевести на @X».
          suggestedAdmin: sql<string | null>`${channels.meta}->>'suggested_admin'`,
          contactReady: contactReadySql,
          // Админ-получатель — бот: авторитетный сигнал tg_users.is_bot
          // (userTypeBot), для гейта «ручной способ» в триаже списка.
          adminIsBot: sql<boolean>`coalesce(${tgUsers.isBot}, false)`,
          // Явно выбранный способ связи (set-admin): channel_dm/group → ручная
          // отправка (см. deriveOutreachState → manual_method).
          contactMethodKind: sql<
            string | null
          >`${channels.meta}->'contact_method'->>'kind'`,
          // Внешний способ (kind=external): свободный label + опц. ссылка для
          // бейджа на карточке.
          contactMethodLabel: sql<
            string | null
          >`${channels.meta}->'contact_method'->>'label'`,
          contactMethodLink: sql<
            string | null
          >`${channels.meta}->'contact_method'->>'link'`,
          total: sql<number>`count(*) OVER ()::int`,
        })
        .from(projectItems)
        .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
        .leftJoin(channels, eq(channels.id, projectItems.channelId))
        .leftJoin(tgUsers, eq(tgUsers.userId, projectItems.tgUserId))
        .where(and(eq(projectItems.projectId, project.id), memberFilter))
        .orderBy(asc(projectItems.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    if (leadRows.length === 0) {
      return c.json({
        total: 0,
        repliedCount,
        leads: [],
      });
    }

    // Две независимые выборки по leadRows — параллельно (обе стартуют после
    // страницы лидов, друг от друга не зависят).
    //  • activityByChannel — активность на рекл-платформах (CPC/CPA), set-based
    //    для каналов страницы (см. fetchPlatformActivity).
    //  • sched — scheduled_messages этих лидов; sentAt/readAt/error нужны
    //    UI-таблице (донор-style), accountId — через какой аккаунт рассылается.
    const [activityByChannel, sched] = await Promise.all([
      fetchPlatformActivity([
        ...new Set(
          leadRows
            .map((l) => l.channelId)
            .filter((id): id is string => id !== null),
        ),
      ]),
      db
        .select({
          itemId: scheduledMessages.itemId,
          accountId: scheduledMessages.accountId,
          messageIdx: scheduledMessages.messageIdx,
          dunningRound: scheduledMessages.dunningRound,
          status: scheduledMessages.status,
          sendAt: scheduledMessages.sendAt,
          sentAt: scheduledMessages.sentAt,
          readAt: scheduledMessages.readAt,
          error: scheduledMessages.error,
        })
        .from(scheduledMessages)
        .where(
          and(
            eq(scheduledMessages.projectId, projectId),
            inArray(
              scheduledMessages.itemId,
              leadRows.map((l) => l.id),
            ),
          ),
        ),
    ]);

    // Sticky-предсказание для draft-лидов (без scheduled_messages):
    // тот же резолвер, что в /activate — гарантирует, что UI совпадёт с
    // реальным распределением при активации.
    const byLead = Map.groupBy(sched, (s) => s.itemId);
    const tgUserIdsNeedingSticky = leadRows
      .filter((l) => l.tgUserId && !byLead.has(l.id))
      .map((l) => l.tgUserId!);
    const stickyByTgUserId = await resolveStickyByTgUserIds(
      wsId,
      tgUserIdsNeedingSticky,
    );

    // Account info — один SELECT по объединённому множеству:
    // (фактические из scheduled) ∪ (sticky-предсказания из contacts).
    const accountIds = [
      ...new Set([
        ...sched.map((s) => s.accountId),
        ...stickyByTgUserId.values(),
      ]),
    ];
    const accountRows = accountIds.length
      ? await db
          .select({
            id: outreachAccounts.id,
            firstName: outreachAccounts.firstName,
            tgUsername: outreachAccounts.externalUsername,
            phoneNumber: outreachAccounts.phoneNumber,
            hasPremium: outreachAccounts.hasPremium,
          })
          .from(outreachAccounts)
          .where(inArray(outreachAccounts.id, accountIds))
      : [];
    const accountById = new Map(accountRows.map((a) => [a.id, a]));

    // Проверочная РКН-рассылка включена на проекте → сегмент «нет РКН» не
    // терминал (см. deriveOutreachState / opener.rknText).
    const rknProbe = isRknProbeEnabled(project.opener);

    return c.json({
      total: leadRows[0]?.total ?? 0,
      repliedCount,
      leads: leadRows.map((l) => {
        const items = byLead.get(l.id) ?? [];
        // Аккаунт берём из первого scheduled_message — все сообщения этого
        // лида ходят через один аккаунт (см. activate logic). Если scheduled
        // ещё нет (draft) — пробуем sticky-предсказание.
        const scheduledAccountId = items[0]?.accountId ?? null;
        const stickyAccountId = l.tgUserId
          ? stickyByTgUserId.get(l.tgUserId) ?? null
          : null;
        const accountId = scheduledAccountId ?? stickyAccountId;
        const account = accountId
          ? accountById.get(accountId) ?? null
          : null;
        const accountSource: "scheduled" | "sticky" | null = scheduledAccountId
          ? "scheduled"
          : stickyAccountId
            ? "sticky"
            : null;
        const messages = items
          .toSorted((a, b) => a.messageIdx - b.messageIdx)
          .map((s) => ({
            messageIdx: s.messageIdx,
            dunningRound: s.dunningRound,
            status: s.status,
            sentAt: s.sentAt?.toISOString() ?? null,
            readAt: s.readAt?.toISOString() ?? null,
            scheduledAt: s.sendAt?.toISOString() ?? null,
            error: s.error,
          }));
        return {
          id: l.id,
          username: l.username,
          tgUserId: l.tgUserId,
          properties: l.properties,
          account,
          accountSource,
          messages,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          contactHistory: l.tgUserId
            ? { talked: l.alreadyTalked, replied: l.alreadyReplied }
            : null,
          lastMessageAt: l.lastMessageAt?.toISOString() ?? null,
          contactId: l.contactId,
          unreadCount: l.unreadCount,
          markedUnread: l.markedUnread,
          nextStep: l.nextStep,
          stageId: l.stageId,
          contactReady: l.contactReady,
          skippedAt: l.skippedAt?.toISOString() ?? null,
          outreachState: deriveOutreachState({
            repliedAt: l.repliedAt,
            skippedAt: l.skippedAt,
            contactReady: l.contactReady,
            channelRknBlocked: l.channelRknBlocked,
            rknProbe,
            adminIsBot: l.adminIsBot,
            contactMethodKind: l.contactMethodKind,
            messages,
          }),
          channel: l.channelId
            ? {
                id: l.channelId,
                title: l.channelTitle ?? "",
                username: l.channelUsername,
                link: l.channelLink,
                platform: l.channelPlatform ?? "telegram",
                memberCount: l.channelMemberCount,
                isRkn: l.channelIsRkn ?? false,
                platformActivity: activityByChannel.get(l.channelId) ?? null,
                relationStatus: l.channelRelationStatus ?? "none",
                suggestedAdmin: l.suggestedAdmin ?? null,
              }
            : null,
          contactMethod: l.contactMethodKind
            ? {
                kind: l.contactMethodKind,
                label: l.contactMethodLabel,
                link: l.contactMethodLink,
              }
            : null,
        };
      }),
    });
  },
);

// Перенос карточки между стадиями канбана (drag-drop). Принимает stageId
// — id из project.stages[*].id или null (вернуть в «Без стадии»). Сервер
// валидирует что stageId существует в текущем project.stages.
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({
        itemId: z.string().min(1).max(64),
      }),
      body: {
        content: { "application/json": { schema: MoveItemBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Moved" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { stageId } = c.req.valid("json");

    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status === "done") {
      throw new HTTPException(400, {
        message: "Проект завершён — карточки заморожены",
      });
    }
    if (
      stageId !== null &&
      !(project.stages as ProjectStage[]).some((s) => s.id === stageId)
    ) {
      throw new HTTPException(400, { message: "unknown stage" });
    }

    const result = await db
      .update(projectItems)
      .set({ stageId })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    return c.body(null, 204);
  },
);

// Удаление лида из проекта. Разрешено только в draft — на этом этапе
// scheduled_messages ещё не созданы, ни одна отправка не ушла. После активации
// (active/paused/done) удаление запрещено: лид мог получить первое сообщение,
// и удалить его молча — потерять историю операции.
app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({
        itemId: z.string().min(1).max(64),
      }),
    },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "draft") {
      throw new HTTPException(400, {
        message: "Удалять лидов можно только в черновом проекте",
      });
    }
    const result = await db
      .delete(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    return c.body(null, 204);
  },
);

// Исключение лида из авто-рассылки в идущем проекте — точечный стоп-кран
// вместо паузы всей кампании (в draft лида просто удаляют). Pending-строки
// удаляем (не cancel): лид возвращается в «незапланированное» состояние, и
// «Вернуть в рассылку» / явный запуск работают тем же путём, что доливка,
// без дублей (item, msg_idx). Уже отправленное (sent) не трогаем — история.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/skip",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
    },
    responses: { 204: { description: "Skipped" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active" && project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Исключать из рассылки можно только в запущенном проекте",
      });
    }
    const result = await db
      .update(projectItems)
      .set({ skippedAt: new Date() })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    await db
      .delete(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.itemId, itemId),
          eq(scheduledMessages.status, "pending"),
        ),
      );
    emitProjectChanged(projectId);
    return c.body(null, 204);
  },
);

// Возврат скипнутого лида в рассылку. Если рассылка по списку ещё идёт
// (горячо) и цепочка лида не начата — опенер сразу встаёт в очередь; если
// список отыгран (холодно) — лид попадает под баннер «Запустить рассылку
// по новым» (то же правило, что у доливки).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unskip",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
    },
    responses: { 204: { description: "Unskipped" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .update(projectItems)
      .set({ skippedAt: null })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    if (project.status === "active" || project.status === "paused") {
      // model A: вернул лида в рассылку → опенер планируется сразу, без
      // холодного гейта (раньше требовался hasPendingOpeners).
      await scheduleUnscheduledLeads({ project, itemId });
    }
    emitProjectChanged(projectId);
    return c.body(null, 204);
  },
);

// Ручной вкл/выкл пиналки на лиде (этап C, кнопка в чате). Пиналка — режим
// on/off: «вкл» планирует новый заход серии пингов (round=max+1, первый пинг от
// последней активности), «выкл» гасит pending текущего захода. Доступно как раз
// для ответивших-и-замолчавших — менеджер видит переписку и решает допинать.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/dunning",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ enabled: z.boolean() }).openapi("ToggleDunning"),
          },
        },
      },
    },
    responses: { 204: { description: "Toggled" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { enabled } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active" && project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Пиналку можно вкл/выкл только в запущенном проекте",
      });
    }
    // Скоуп: item должен принадлежать ЭТОМУ проекту. assertProjectAccess
    // проверяет только projectId из URL — без этой проверки по доступу к своему
    // проекту можно было бы взвести/погасить пиналку на чужом лиде (IDOR).
    const [item] = await db
      .select({ id: projectItems.id })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!item) throw new HTTPException(404, { message: "item not found" });

    if (enabled) {
      const result = await armLeadDunning(itemId);
      if (result === "empty") {
        throw new HTTPException(400, {
          message: "Пиналка не настроена или нет истории отправок по лиду",
        });
      }
    } else {
      await disarmLeadDunning(itemId);
    }
    emitProjectChanged(projectId);
    return c.body(null, 204);
  },
);

export default app;

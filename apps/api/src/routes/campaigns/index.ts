import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  outreachAccounts,
  placementClientStatus,
  placementContractStatus,
  placementCreativeStatus,
  placementMetricsStatus,
  type PlacementStepMessages,
  projectItems,
  projects,
  scheduledMessages,
  tgChats,
  tgUsers,
} from "../../db/schema.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import { channelIsRknSql } from "../../lib/rkn-registry.ts";
import {
  resolveProjectAccountIds,
  scheduleLeads,
  FINAL_OFFER_MSG_IDX,
} from "../../lib/project-scheduling.ts";
import { pickDefined } from "../../lib/pick-defined.ts";
import { parseChannelInput } from "@repo/core";
import { detectChannelPlatform } from "../../lib/channel-providers/index.ts";
import { resolveAdminRecipient } from "../../lib/placement-recipient.ts";
import {
  type PostSnapshot,
  PostSnapshotSchema,
} from "../../lib/td-message.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { MsgRefSchema, PlacementParam, WsProjectParam } from "./shared.ts";
import offerApp from "./offer.ts";
import productionApp from "./production.ts";

// Agency-кампания переиспользует projects (kind='agency') + project_items
// (kind='placement'). Базовые операции над кампанией (создание, бриф, phase,
// активация аутрича, цепочка) живут в projects.ts. Здесь — медиаплан:
// размещения (placements). Аутрич по лонглисту шлёт worker через те же
// scheduled_messages; получатель — админ канала (item.contact_id/username,
// проставляются при добавлении размещения).
//
// Stage:
//   longlist  — shortlisted_at IS NULL  (ещё опрашиваем)
//   shortlist — shortlisted_at NOT NULL (собран, ушёл клиенту на согласование)

const ClientStatusSchema = z.enum(placementClientStatus.enumValues);
// Статус коммуникации с блогером — производный из scheduled_messages + ответа.
const ChainStatusSchema = z.enum([
  "not_sent",
  "sent",
  "read",
  "replied",
  "declined",
]);

// Кто отказался по размещению (при available=false): blogger — их решение (не
// хочет работать), us — наше (цена не устроила, нет свободных дат, не подошёл).
const DeclineBySchema = z.enum(["blogger", "us"]);

const StepMessagesSchema = z.object({
  contract: MsgRefSchema.optional(),
  creative: MsgRefSchema.optional(),
  act: MsgRefSchema.optional(),
});

const PlacementSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        id: z.string(),
        title: z.string(),
        username: z.string().nullable(),
        platform: z.enum(["telegram", "youtube", "tiktok", "dzen", "max"]),
        memberCount: z.number().int().nullable(),
        // Авто-метрики из ленты (этап 16.10): ср.охват + ERR. Живые из
        // channels.meta — на согласовании клиент видит актуальные, а не снимок.
        avgReach: z.number().nullable(),
        err: z.number().nullable(),
        // DM-путь канала (этап 16.8): есть ли личка и сколько звёзд стоит
        // отправка. dmStarCost === 0 → бесплатно (засчитывается готовым
        // контактом для гейта); >0 → менеджер пишет руками; null → ещё не
        // синкали. Источник — channels.meta (sync пишет
        // has_dm / outgoing_paid_message_star_count).
        hasDm: z.boolean(),
        dmStarCost: z.number().int().nullable(),
        // РКН-индикация: memberCount > 10k и !isRkn — красная тревога.
        isRkn: z.boolean(),
      })
      .nullable(),
    adminContactId: z.string().nullable(),
    adminUsername: z.string().nullable(),
    hasRecipient: z.boolean(),
    // Готовность контакта для гейта запуска (этап 16.8): у канала есть
    // привязанный админ (живой channel_admins, не снапшот item.contact_id) ИЛИ
    // доступна бесплатная личка (hasDm && dmStarCost===0). Жёсткий гейт
    // требует contactReady=true у всех размещений лонглиста.
    contactReady: z.boolean(),
    // Непрочитанные в переписке с админом (этап 16.10): из contacts.unreadCount,
    // который репликатор держит live. У каналов одного админа — одинаковое.
    unread: z.number().int(),
    // «Тёплый» канал (этап 16.9 п.5): кто-то из аккаунтов команды уже в личном
    // диалоге с админом. Помогает в лонглисте отличить знакомых от холодных.
    teamKnowsAdmin: z.boolean(),
    // Привязанный админ — бот (авторитетно, tg_users.is_bot). Бот = ручной
    // способ: авто-опенер не шлётся, в дровере плашка «напишите вручную».
    adminIsBot: z.boolean(),
    // Аккаунт, через который идёт аутрич этому блогеру (после активации).
    account: z
      .object({
        id: z.string(),
        firstName: z.string().nullable(),
        tgUsername: z.string().nullable(),
      })
      .nullable(),
    chainStatus: ChainStatusSchema,
    // Компактная аутрич-сводка для одного статус-столбца в таблице.
    outreach: z.object({
      totalSteps: z.number().int(), // запланировано сообщений (= шагов цепочки)
      sentCount: z.number().int(), // отправлено
      read: z.boolean(), // прочитано хотя бы одно
      lastSentAt: z.iso.datetime().nullable(),
    }),
    available: z.boolean().nullable(),
    priceAmount: z.number().nullable(),
    // Цена для клиента (null = совпадает с priceAmount).
    clientPrice: z.number().nullable(),
    forecastViews: z.number().int().nullable(),
    forecastErr: z.number().nullable(),
    // Блок «блогеру» (ценообразование сделки, живёт на размещении).
    // surchargePercent — «% сверху» (надбавка, не важно налог/комиссия);
    // bloggerVat — эта надбавка есть НДС (зачётный); format — выбранный формат
    // под цену; quotedRates — весь прайс блогера как ответил.
    surchargePercent: z.number().nullable(),
    bloggerVat: z.boolean(),
    format: z.string().nullable(),
    quotedRates: z.string().nullable(),
    // Доля создания контента в % (0..100) при сплите (срез 5). Остальное —
    // размещение, на него +3% ОРД. null = без сплита. Активна при project.splitEnabled.
    createShare: z.number().nullable(),
    clientStatus: ClientStatusSchema,
    clientStatusComment: z.string().nullable(),
    shortlistedAt: z.iso.datetime().nullable(),
    // Причина отказа (при available=false): кто отказался + текст. blogger — их
    // решение, us — наше (цена/даты/не подошёл). null = не отказ или без причины.
    declineBy: DeclineBySchema.nullable(),
    declineNote: z.string().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    // production (фаза 5)
    finalOfferSentAt: z.iso.datetime().nullable(),
    finalOfferStatus: z.enum(["none", "queued", "sent", "failed"]),
    contractStatus: z.enum(placementContractStatus.enumValues),
    creativeStatus: z.enum(placementCreativeStatus.enumValues),
    creativeRound: z.number().int(),
    // Ссылка на Google-док согласования креатива (авто-создаётся). null = дока
    // ещё нет (не жали «Собрать на согласование»).
    creativeDocUrl: z.string().nullable(),
    // Текущий базлайн/финальный текст креатива из дока (что байер шлёт блогеру на
    // blogger_review). null = ещё не собирали.
    creativeDocText: z.string().nullable(),
    scheduledAt: z.iso.datetime().nullable(),
    erid: z.string().nullable(),
    eridAdvertiserData: z.string().nullable(),
    postUrl: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    actReceivedAt: z.iso.datetime().nullable(),
    // помеченные сообщения чата (договор/креатив/акт) + ЕРИД-отправка + коммент
    // клиента к креативу
    stepMessages: StepMessagesSchema.nullable(),
    eridSentAt: z.iso.datetime().nullable(),
    creativeClientComment: z.string().nullable(),
    creativeClientSentAt: z.iso.datetime().nullable(),
    // отчёт (фаза 6) — снимок метрик поста через TDLib
    metricsStatus: z.enum(placementMetricsStatus.enumValues),
    metricsViews: z.number().int().nullable(),
    metricsLikes: z.number().int().nullable(),
    metricsComments: z.number().int().nullable(),
    metricsShares: z.number().int().nullable(),
    metricsCollectedAt: z.iso.datetime().nullable(),
    metricsError: z.string().nullable(),
    postSnapshot: PostSnapshotSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Placement");

const UpdatePlacementBody = z
  .object({
    available: z.boolean().nullable().optional(),
    priceAmount: z.number().nonnegative().nullable().optional(),
    clientPrice: z.number().nonnegative().nullable().optional(),
    forecastViews: z.number().int().nonnegative().nullable().optional(),
    forecastErr: z.number().nonnegative().nullable().optional(),
    // Блок «блогеру» — редактируется в сделке-панели.
    surchargePercent: z.number().min(0).max(100).nullable().optional(),
    bloggerVat: z.boolean().optional(),
    format: z.string().max(200).nullable().optional(),
    quotedRates: z.string().max(4000).nullable().optional(),
    createShare: z.number().min(0).max(100).nullable().optional(),
    clientStatus: ClientStatusSchema.optional(),
    // true → добавить в шортлист (проставить shortlisted_at=now), false → вернуть
    // в лонглист (сбросить). Явная кнопка «В шортлист» у менеджера.
    shortlisted: z.boolean().optional(),
    // Причина отказа — шлётся вместе с available:false. При available:true
    // (возврат в работу) поля чистятся сервером.
    declineBy: DeclineBySchema.optional(),
    declineNote: z.string().max(2000).nullable().optional(),
    // production (фаза 5)
    contractStatus: z.enum(placementContractStatus.enumValues).optional(),
    creativeStatus: z.enum(placementCreativeStatus.enumValues).optional(),
    creativeRound: z.number().int().min(0).optional(),
    scheduledAt: z.iso.datetime().nullable().optional(),
    erid: z.string().max(200).nullable().optional(),
    eridAdvertiserData: z.string().max(500).nullable().optional(),
    postUrl: z.string().max(500).nullable().optional(),
    publishedAt: z.iso.datetime().nullable().optional(),
    actReceivedAt: z.iso.datetime().nullable().optional(),
    eridSentAt: z.iso.datetime().nullable().optional(),
    creativeClientComment: z.string().max(2000).nullable().optional(),
  })
  .openapi("UpdatePlacement");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Производный статус цепочки. repliedAt и факт отправки — источник истины
// аутрича; available=false — ручная отметка отказа.
function chainStatus(
  repliedAt: Date | null,
  available: boolean | null,
  sentCount: number,
  read: boolean,
): z.infer<typeof ChainStatusSchema> {
  // Ручной отказ менеджера перебивает авто-статус: блогер мог ответить
  // («дорого/не интересно»), но «Отказ» — финальное решение, строка должна
  // уйти из лонглиста независимо от repliedAt.
  if (available === false) return "declined";
  if (repliedAt) return "replied";
  if (read) return "read";
  if (sentCount > 0) return "sent";
  return "not_sent";
}

// Аутрич-сводка по item'ам из scheduled_messages, одним запросом.
async function outreachByItem(itemIds: string[]) {
  const map = new Map<
    string,
    {
      totalSteps: number;
      sentCount: number;
      read: boolean;
      lastSentAt: Date | null;
      accountId: string | null;
      // статус финального оффера (msg_idx=FINAL_OFFER_MSG_IDX), отдельно от
      // холодной цепочки. null = оффер не ставился.
      finalOffer: string | null;
    }
  >();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({
      itemId: scheduledMessages.itemId,
      accountId: scheduledMessages.accountId,
      status: scheduledMessages.status,
      messageIdx: scheduledMessages.messageIdx,
      sentAt: scheduledMessages.sentAt,
      readAt: scheduledMessages.readAt,
    })
    .from(scheduledMessages)
    .where(inArray(scheduledMessages.itemId, itemIds));
  // приоритет статуса оффера при нескольких попытках: sent > pending > failed.
  const offerRank = (s: string) =>
    s === "sent" ? 3 : s === "pending" ? 2 : s === "failed" ? 1 : 0;
  for (const r of rows) {
    const e = map.get(r.itemId) ?? {
      totalSteps: 0,
      sentCount: 0,
      read: false,
      lastSentAt: null as Date | null,
      accountId: null as string | null,
      finalOffer: null as string | null,
    };
    if (r.messageIdx === FINAL_OFFER_MSG_IDX) {
      if (e.finalOffer === null || offerRank(r.status) > offerRank(e.finalOffer)) {
        e.finalOffer = r.status;
      }
      // accountId берём и отсюда: у shortlist-direct размещения финальный оффер
      // может быть единственным сообщением, и это его «липкий» аккаунт DM.
      e.accountId ??= r.accountId;
      map.set(r.itemId, e);
      continue; // в счётчики холодной цепочки финальный оффер не мешаем
    }
    e.totalSteps += 1;
    if (r.status === "sent") e.sentCount += 1;
    if (r.readAt) e.read = true;
    if (r.sentAt && (!e.lastSentAt || r.sentAt > e.lastSentAt)) {
      e.lastSentAt = r.sentAt;
    }
    e.accountId ??= r.accountId;
    map.set(r.itemId, e);
  }
  return map;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      query: z.object({
        // longlist (опрос, shortlisted_at IS NULL) | shortlist (собранные) | all
        stage: z.enum(["longlist", "shortlist", "all"]).default("all"),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(PlacementSchema) } },
        description: "Placements (медиаплан)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { stage } = c.req.valid("query");
    await assertProjectAccess(projectId, wsId, userId, role);

    const stageClause =
      stage === "longlist"
        ? sql`${projectItems.shortlistedAt} IS NULL`
        : stage === "shortlist"
          ? sql`${projectItems.shortlistedAt} IS NOT NULL`
          : undefined;

    const rows = await db
      .select(placementColumns())
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
      .where(
        and(
          eq(projectItems.projectId, projectId),
          stageClause,
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    const outreach = await outreachByItem(rows.map((r) => r.id));
    const accounts = await loadAccounts(
      [...outreach.values()].map((o) => o.accountId),
    );
    return c.json(rows.map((r) => serializePlacement(r, outreach, accounts)));
  },
);

// ── Доливка размещений в активную кампанию ──────────────────────────────────
// Если кампания уже active/paused, новые размещения должны сразу пойти в аутрич
// по опенеру + пиналке воркспейса, независимо от уже запущенных волн —
// offset'ы цепочки считаются от now(). Тот же общий конвейер scheduleLeads,
// что и в активации (project-scheduling).
//
// dolivkaAccountsOrThrow вызывается ДО вставки размещений: если кампания активна,
// но слать нечем (нет цепочки/аккаунтов) — 400 без частичного состояния. Для
// draft возвращает null (доливки нет, /activate запланирует всех разом).
async function dolivkaAccountsOrThrow(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<string[] | null> {
  // В завершённую/архивную кампанию добавлять каналы нельзя — цепочка отыграна,
  // размещение осталось бы orphan'ом без рассылки.
  if (project.status === "done" || project.status === "archived") {
    throw new HTTPException(400, {
      message: "Кампания завершена — добавлять каналы нельзя",
    });
  }
  if (project.status !== "active" && project.status !== "paused") return null;
  if (!project.opener.text.trim()) {
    throw new HTTPException(400, {
      message: "У кампании нет опенера — нечего слать новым блогерам",
    });
  }
  const accountIds = await resolveProjectAccountIds(wsId, project);
  if (accountIds.length === 0) {
    throw new HTTPException(400, {
      message: "Нет активных Telegram-аккаунтов для доливки",
    });
  }
  return accountIds;
}

type InsertedPlacement = {
  id: string;
  channelId: string | null;
  username: string | null;
  tgUserId: string | null;
  // Нужен MAX-пути: из контакта резолвится пир получателя (см. scheduleLeads).
  contactId: string | null;
  properties: unknown;
};

async function scheduleDolivka(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  accountIds: string[];
  inserted: InsertedPlacement[];
}) {
  // Добавил канал в идущий проект (active/paused) → опенер новым уходит сразу,
  // без отдельной кнопки-подтверждения (model A: «active = шлёт», не хочешь —
  // пауза). Прежний холодный гейт (hasPendingOpeners) убран: он порождал
  // кнопку «Дослать новым» с врущим счётчиком.
  // Общий конвейер с активацией (scheduleLeads): дедуп по админу + синтез
  // канало-vars + sticky/warm. skipContacted=true — повторный опенер уже
  // начатым тредам не шлём; prepareLeads внутри отбрасывает размещения без
  // получателя.
  const rows = await scheduleLeads({
    wsId: opts.wsId,
    project: opts.project,
    accountIds: opts.accountIds,
    leads: opts.inserted.map((p) => ({
      id: p.id,
      username: p.username,
      tgUserId: p.tgUserId,
      contactId: p.contactId,
      properties: (p.properties ?? {}) as Record<string, unknown>,
    })),
    baseTime: new Date(),
    skipContacted: true,
  });
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(scheduledMessages).values(rows.slice(i, i + CHUNK));
  }
}

// Массовое добавление: по одному URL/@username на строку. Канал, которого нет
// в базе, заводим болванкой (title=@username) — реальные title/подписчики
// подтянет ленивый sync при первом открытии ChannelDrawer. Получателя
// (контакт админа) резолвим, если он уже привязан; нет — размещение без
// получателя (привязать можно в сайдбаре канала).
const BulkPlacementsBody = z
  .object({
    identifiers: z.array(z.string().min(1).max(200)).min(1).max(300),
  })
  .openapi("BulkPlacements");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: BulkPlacementsBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              added: z.number().int(),
              channelsCreated: z.number().int(),
              skippedInvalid: z.number().int(),
              skippedDuplicate: z.number().int(),
            }),
          },
        },
        description: "Bulk add result",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { identifiers } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    // До вставки: на активной кампании проверяем, что доливку есть чем слать.
    const dolivkaAccounts = await dolivkaAccountsOrThrow(wsId, project);

    // Платформу детектим на КАЖДУЮ строку: ссылка YouTube/TikTok → провайдер-
    // канал (профиль резолвит ленивый sync), иначе TG @username (как раньше).
    // Ключ дедупа — platform + нормализованный идентификатор.
    type ParsedAdd =
      | { platform: "telegram"; key: string; uname: string }
      // Приватный TG-канал по инвайт-ссылке (t.me/+abc): @username нет, заводим
      // болванку по link; админа/мету подтянет drawer/sync после вступления.
      | { platform: "telegram"; key: string; link: string }
      | {
          platform: "youtube" | "tiktok" | "dzen" | "max";
          key: string;
          link: string;
        };
    let skippedInvalid = 0;
    const seen = new Set<string>();
    const adds: ParsedAdd[] = [];
    for (const raw of identifiers) {
      const platform = detectChannelPlatform(raw);
      let entry: ParsedAdd | null;
      if (platform === "telegram") {
        // Единый парсер TG-адреса (правила username = TDLib is_allowed_username,
        // см. parse-channel-input.ts): отдаёт публичный @username ИЛИ приватную
        // инвайт-ссылку за один проход.
        const { username, inviteLink } = parseChannelInput(raw);
        if (username) {
          entry = { platform, key: `telegram:${username}`, uname: username };
        } else if (inviteLink) {
          entry = {
            platform,
            key: `telegram:invite:${inviteLink.toLowerCase()}`,
            link: inviteLink,
          };
        } else {
          skippedInvalid++;
          continue;
        }
      } else {
        const link = raw.trim();
        entry = { platform, key: `${platform}:${link.toLowerCase()}`, link };
      }
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      adds.push(entry);
    }

    let added = 0;
    let channelsCreated = 0;
    let skippedDuplicate = 0;
    const insertedItems: InsertedPlacement[] = [];

    for (const a of adds) {
      // find-or-create канал: публичный TG по lower(username), остальное (провайдер
      // + приватный TG по инвайт-ссылке) — по lower(link).
      const byUsername = "uname" in a;
      const matchCh = byUsername
        ? sql`lower(${channels.username}) = ${a.uname}`
        : sql`lower(${channels.link}) = ${a.link.toLowerCase()}`;
      let [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, wsId),
            eq(channels.platform, a.platform),
            matchCh,
          ),
        )
        .limit(1);
      if (!ch) {
        const [created] = await db
          .insert(channels)
          .values(
            byUsername
              ? {
                  workspaceId: wsId,
                  title: `@${a.uname}`,
                  username: a.uname,
                  platform: "telegram",
                  createdBy: userId,
                }
              : {
                  workspaceId: wsId,
                  // title — заглушка; sync провайдера / drawer перезапишет.
                  title: a.platform === "telegram" ? "Приватный канал" : a.link,
                  link: a.link,
                  platform: a.platform,
                  createdBy: userId,
                },
          )
          .onConflictDoNothing()
          .returning({ id: channels.id });
        if (created) {
          ch = created;
          channelsCreated++;
        } else {
          // Параллельная вставка того же канала — берём существующий.
          [ch] = await db
            .select({ id: channels.id })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                eq(channels.platform, a.platform),
                matchCh,
              ),
            )
            .limit(1);
        }
      }
      if (!ch) continue;

      const [existing] = await db
        .select({ id: projectItems.id })
        .from(projectItems)
        .where(
          and(
            eq(projectItems.projectId, projectId),
            eq(projectItems.channelId, ch.id),
          ),
        )
        .limit(1);
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      // TG-канал — полный получатель (авто-опенер по @username). Провайдер-канал
      // (youtube/…): авто-рассылки нет, но contactId переносим — иначе канал с
      // привязанным контактом (напр. external-stub с заметками), добавленный во
      // второй проект, терял бы связь с контактом («Открыть контакт» пропадал).
      const resolved = await resolveAdminRecipient(ch.id);
      const admin =
        a.platform === "telegram"
          ? resolved
          : { contactId: resolved.contactId, username: null, tgUserId: null };
      const [ins] = await db
        .insert(projectItems)
        .values({
          workspaceId: wsId,
          projectId,
          channelId: ch.id,
          contactId: admin.contactId,
          username: admin.username,
          tgUserId: admin.tgUserId,
        })
        .returning();
      if (ins) insertedItems.push(ins);
      added++;
    }

    // Доливка: новые размещения на активной кампании сразу уходят в аутрич.
    if (dolivkaAccounts) {
      await scheduleDolivka({
        wsId,
        project,
        accountIds: dolivkaAccounts,
        inserted: insertedItems,
      });
    }

    // Скан канала ленивый — подтянется при открытии (ChannelCard auto-sync),
    // авто-скан на добавлении убрали ради меньшего флуда (этап 16.10).
    return c.json({ added, channelsCreated, skippedInvalid, skippedDuplicate });
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: {
      params: PlacementParam,
      body: {
        content: { "application/json": { schema: UpdatePlacementBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: PlacementSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    const body = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [updated] = await db
      .update(projectItems)
      .set({
        ...(body.available !== undefined && { available: body.available }),
        // Причина отказа: пишем при отказе; при возврате в работу (available:true,
        // напр. «Согласован») — чистим, чтобы не осталась протухшая причина.
        ...(body.available === true && { declineBy: null, declineNote: null }),
        ...(body.declineBy !== undefined && { declineBy: body.declineBy }),
        ...(body.declineNote !== undefined && { declineNote: body.declineNote }),
        ...(body.priceAmount !== undefined && {
          priceAmount:
            body.priceAmount === null ? null : String(body.priceAmount),
        }),
        ...(body.clientPrice !== undefined && {
          clientPrice:
            body.clientPrice === null ? null : String(body.clientPrice),
        }),
        ...(body.forecastViews !== undefined && {
          forecastViews: body.forecastViews,
        }),
        ...(body.forecastErr !== undefined && {
          forecastErr:
            body.forecastErr === null ? null : String(body.forecastErr),
        }),
        // Блок «блогеру»: numeric → String (как priceAmount); bool/text —
        // прямым копированием через pickDefined ниже.
        ...(body.surchargePercent !== undefined && {
          surchargePercent:
            body.surchargePercent === null
              ? null
              : String(body.surchargePercent),
        }),
        ...(body.createShare !== undefined && {
          createShare:
            body.createShare === null ? null : String(body.createShare),
        }),
        // Смена статуса менеджером — это новое решение: сбрасываем коммент
        // (он принадлежал прежнему статусу клиента) и обновляем отметку
        // времени, чтобы comment/at не рассинхронизировались со статусом.
        ...(body.clientStatus !== undefined && {
          clientStatus: body.clientStatus,
          clientStatusComment: null,
          clientStatusAt: new Date(),
        }),
        ...(body.shortlisted !== undefined && {
          shortlistedAt: body.shortlisted ? new Date() : null,
        }),
        // production: enum/text/int/jsonb — прямое копирование (null валиден).
        ...pickDefined(body, [
          "bloggerVat",
          "format",
          "quotedRates",
          "contractStatus",
          "creativeStatus",
          "creativeRound",
          "erid",
          "eridAdvertiserData",
          "postUrl",
          "creativeClientComment",
        ]),
        ...(body.scheduledAt !== undefined && {
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        }),
        ...(body.publishedAt !== undefined && {
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
        }),
        ...(body.actReceivedAt !== undefined && {
          actReceivedAt: body.actReceivedAt
            ? new Date(body.actReceivedAt)
            : null,
        }),
        ...(body.eridSentAt !== undefined && {
          eridSentAt: body.eridSentAt ? new Date(body.eridSentAt) : null,
        }),
        // Переход в client_review = «отправили клиенту» → стампим время сервером
        // (для подсветки «креатив правлен после отправки»).
        ...(body.creativeStatus === "client_review" && {
          creativeClientSentAt: new Date(),
        }),
      })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
        ),
      )
      .returning({ id: projectItems.id });
    if (!updated) throw new HTTPException(404, { message: "placement not found" });

    const placement = await loadPlacement(placementId);
    return c.json(placement!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: { params: PlacementParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .delete(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
        ),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "placement not found" });
    }
    return c.body(null, 204);
  },
);

// Колонки placement-строки (общие для list/load).
function placementColumns() {
  return {
    id: projectItems.id,
    available: projectItems.available,
    priceAmount: projectItems.priceAmount,
    clientPrice: projectItems.clientPrice,
    forecastViews: projectItems.forecastViews,
    forecastErr: projectItems.forecastErr,
    surchargePercent: projectItems.surchargePercent,
    bloggerVat: projectItems.bloggerVat,
    format: projectItems.format,
    quotedRates: projectItems.quotedRates,
    createShare: projectItems.createShare,
    clientStatus: projectItems.clientStatus,
    clientStatusComment: projectItems.clientStatusComment,
    shortlistedAt: projectItems.shortlistedAt,
    declineBy: projectItems.declineBy,
    declineNote: projectItems.declineNote,
    repliedAt: projectItems.repliedAt,
    finalOfferSentAt: projectItems.finalOfferSentAt,
    contractStatus: projectItems.contractStatus,
    creativeStatus: projectItems.creativeStatus,
    creativeRound: projectItems.creativeRound,
    creativeDocUrl: projectItems.creativeDocUrl,
    creativeDocText: projectItems.creativeDocText,
    scheduledAt: projectItems.scheduledAt,
    erid: projectItems.erid,
    eridAdvertiserData: projectItems.eridAdvertiserData,
    postUrl: projectItems.postUrl,
    publishedAt: projectItems.publishedAt,
    actReceivedAt: projectItems.actReceivedAt,
    stepMessages: projectItems.stepMessages,
    eridSentAt: projectItems.eridSentAt,
    creativeClientComment: projectItems.creativeClientComment,
    creativeClientSentAt: projectItems.creativeClientSentAt,
    metricsStatus: projectItems.metricsStatus,
    metricsViews: projectItems.metricsViews,
    metricsLikes: projectItems.metricsLikes,
    metricsComments: projectItems.metricsComments,
    metricsShares: projectItems.metricsShares,
    metricsCollectedAt: projectItems.metricsCollectedAt,
    metricsError: projectItems.metricsError,
    postSnapshot: projectItems.postSnapshot,
    createdAt: projectItems.createdAt,
    contactId: projectItems.contactId,
    username: projectItems.username,
    tgUserId: projectItems.tgUserId,
    channelId: channels.id,
    channelTitle: channels.title,
    channelUsername: channels.username,
    channelPlatform: channels.platform,
    channelMembers: channels.memberCount,
    // Авто-метрики из ленты (meta пишет /history): ср.охват + ERR. Живые.
    channelAvgReach: sql<number | null>`(${channels.meta} ->> 'avg_reach')::int`,
    channelErr: sql<number | null>`(${channels.meta} ->> 'err')::float8`,
    // Бесплатная личка канала: есть DM-группа (direct_messages_chat_id кладёт
    // сам sync) — НЕ has_dm, который пишет репликатор асинхронно (этап 16.8).
    channelHasDm: sql<boolean>`coalesce(${channels.meta} ->> 'direct_messages_chat_id', '0') <> '0'`,
    channelDmStarCost: sql<
      number | null
    >`(${channels.meta} ->> 'outgoing_paid_message_star_count')::int`,
    // Живой признак «у канала есть привязанный админ» — не зависит от снапшота
    // item.contact_id (админа могли привязать уже после создания размещения).
    channelHasAdmin: sql<boolean>`exists (select 1 from ${channelAdmins} where ${channelAdmins.channelId} = ${channels.id})`,
    channelIsRkn: channelIsRknSql,
    // Явно выбранный способ связи (группа / личка-канала) в meta.contact_method
    // (этап 16.9): тоже готовый контакт.
    channelMethodSet: sql<boolean>`(${channels.meta} -> 'contact_method' ->> 'kind') is not null`,
    adminUsername: sql<
      string | null
    >`${contacts.properties} ->> 'telegram_username'`,
    unread: contacts.unreadCount,
    // «Команда уже в контакте с этим админом» (этап 16.9 п.5): админ нам
    // ОТВЕТИЛ хотя бы раз через любой аккаунт воркспейса (has_inbound — тот же
    // сигнал, что у кружочков в /channels, чтобы лонглист и таблица не
    // расходились). Не «мы написали» и не пустой openChat.
    teamKnowsAdmin: sql<boolean>`exists (
      select 1 from ${tgChats}
      join ${outreachAccounts} on ${outreachAccounts.id} = ${tgChats.accountId}
      where ${tgChats.peerUserId} = (${contacts.properties} ->> 'tg_user_id')
        and ${outreachAccounts.workspaceId} = ${channels.workspaceId}
        and ${tgChats.hasInbound} = true
    )`,
    // Привязанный админ-контакт — бот (этап 16.9): авторитетно из tg_users.is_bot
    // по tg_user_id контакта (НЕ суффикс @…bot). Фронт показывает «бот — вручную»
    // и считает канал ручным (бот = не авто-рассылка).
    adminIsBot: sql<boolean>`coalesce((
      select ${tgUsers.isBot} from ${tgUsers}
      where ${tgUsers.userId} = (${contacts.properties} ->> 'tg_user_id')
    ), false)`,
  };
}

async function loadAccounts(ids: (string | null)[]) {
  const real = [...new Set(ids.filter((x): x is string => x !== null))];
  const map = new Map<
    string,
    { id: string; firstName: string | null; tgUsername: string | null }
  >();
  if (real.length === 0) return map;
  const rows = await db
    .select({
      id: outreachAccounts.id,
      firstName: outreachAccounts.firstName,
      tgUsername: outreachAccounts.externalUsername,
    })
    .from(outreachAccounts)
    .where(inArray(outreachAccounts.id, real));
  for (const a of rows) map.set(a.id, a);
  return map;
}

async function loadPlacement(itemId: string) {
  const [row] = await db
    .select(placementColumns())
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(eq(projectItems.id, itemId))
    .limit(1);
  if (!row) return null;
  const outreach = await outreachByItem([itemId]);
  const accounts = await loadAccounts(
    [...outreach.values()].map((o) => o.accountId),
  );
  return serializePlacement(row, outreach, accounts);
}

function serializePlacement(
  row: {
    id: string;
    available: boolean | null;
    priceAmount: string | null;
    clientPrice: string | null;
    forecastViews: number | null;
    forecastErr: string | null;
    surchargePercent: string | null;
    bloggerVat: boolean;
    format: string | null;
    quotedRates: string | null;
    createShare: string | null;
    clientStatus: (typeof placementClientStatus.enumValues)[number];
    clientStatusComment: string | null;
    shortlistedAt: Date | null;
    declineBy: string | null;
    declineNote: string | null;
    repliedAt: Date | null;
    finalOfferSentAt: Date | null;
    contractStatus: (typeof placementContractStatus.enumValues)[number];
    creativeStatus: (typeof placementCreativeStatus.enumValues)[number];
    creativeRound: number;
    creativeDocUrl: string | null;
    creativeDocText: string | null;
    scheduledAt: Date | null;
    erid: string | null;
    eridAdvertiserData: string | null;
    postUrl: string | null;
    publishedAt: Date | null;
    actReceivedAt: Date | null;
    stepMessages: PlacementStepMessages | null;
    eridSentAt: Date | null;
    creativeClientComment: string | null;
    creativeClientSentAt: Date | null;
    metricsStatus: (typeof placementMetricsStatus.enumValues)[number];
    metricsViews: number | null;
    metricsLikes: number | null;
    metricsComments: number | null;
    metricsShares: number | null;
    metricsCollectedAt: Date | null;
    metricsError: string | null;
    postSnapshot: PostSnapshot | null;
    createdAt: Date;
    contactId: string | null;
    username: string | null;
    tgUserId: string | null;
    channelId: string | null;
    channelTitle: string | null;
    channelUsername: string | null;
    channelPlatform: "telegram" | "youtube" | "tiktok" | "dzen" | "max" | null;
    channelMembers: number | null;
    channelAvgReach: number | null;
    channelErr: number | null;
    channelHasDm: boolean;
    channelDmStarCost: number | null;
    channelHasAdmin: boolean;
    channelMethodSet: boolean;
    channelIsRkn: boolean;
    adminUsername: string | null;
    unread: number | null;
    teamKnowsAdmin: boolean;
    adminIsBot: boolean;
  },
  outreachMap: Awaited<ReturnType<typeof outreachByItem>>,
  accountMap: Awaited<ReturnType<typeof loadAccounts>>,
) {
  const o = outreachMap.get(row.id) ?? {
    totalSteps: 0,
    sentCount: 0,
    read: false,
    lastSentAt: null,
    accountId: null,
    finalOffer: null as string | null,
  };
  const account = o.accountId ? accountMap.get(o.accountId) ?? null : null;
  return {
    id: row.id,
    channel: row.channelId
      ? {
          id: row.channelId,
          title: row.channelTitle ?? "—",
          username: row.channelUsername,
          // channelId есть ⇒ канал реальный ⇒ platform (notNull) не null.
          platform: row.channelPlatform!,
          memberCount: row.channelMembers,
          avgReach: row.channelAvgReach,
          err: row.channelErr,
          hasDm: row.channelHasDm,
          dmStarCost: row.channelDmStarCost,
          isRkn: row.channelIsRkn,
        }
      : null,
    adminContactId: row.contactId,
    adminUsername: row.adminUsername,
    // Есть кого адресовать аутричем/оффером (worker резолвит username→tgUserId
    // лениво) — UI считает получателей по этому флагу, как и backend.
    hasRecipient: row.username !== null || row.tgUserId !== null,
    // Готовность для гейта: привязан админ ИЛИ явно выбранный способ связи
    // (contact_method.kind). НЕ засчитываем «у канала просто есть бесплатная
    // личка» — это авто-определение молча выдёргивало лид из «нет контактов»;
    // зеркалит contactReadySql (contact-sql.ts). Личку оператор выбирает явно.
    contactReady: row.channelHasAdmin || row.channelMethodSet,
    unread: row.unread ?? 0,
    teamKnowsAdmin: row.teamKnowsAdmin,
    adminIsBot: row.adminIsBot,
    account,
    chainStatus: chainStatus(row.repliedAt, row.available, o.sentCount, o.read),
    outreach: {
      totalSteps: o.totalSteps,
      sentCount: o.sentCount,
      read: o.read,
      lastSentAt: o.lastSentAt?.toISOString() ?? null,
    },
    available: row.available,
    priceAmount: row.priceAmount === null ? null : Number(row.priceAmount),
    clientPrice: row.clientPrice === null ? null : Number(row.clientPrice),
    forecastViews: row.forecastViews,
    forecastErr: row.forecastErr === null ? null : Number(row.forecastErr),
    surchargePercent:
      row.surchargePercent === null ? null : Number(row.surchargePercent),
    bloggerVat: row.bloggerVat,
    format: row.format,
    quotedRates: row.quotedRates,
    createShare: row.createShare === null ? null : Number(row.createShare),
    clientStatus: row.clientStatus,
    clientStatusComment: row.clientStatusComment,
    shortlistedAt: row.shortlistedAt?.toISOString() ?? null,
    // text-колонка → сужаем к enum'у (на запись валидируется DeclineBySchema,
    // так что в БД только blogger/us/null).
    declineBy: (row.declineBy ?? null) as "blogger" | "us" | null,
    declineNote: row.declineNote,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    finalOfferSentAt: row.finalOfferSentAt?.toISOString() ?? null,
    // Реальный статус доставки финального оффера (из scheduled_messages), а не
    // факт постановки в очередь: none | queued | sent | failed. cancelled (старое
    // до фикса) → none, чтобы можно было переотправить.
    finalOfferStatus: (o.finalOffer === "sent"
      ? "sent"
      : o.finalOffer === "pending"
        ? "queued"
        : o.finalOffer === "failed"
          ? "failed"
          : "none") as "none" | "queued" | "sent" | "failed",
    contractStatus: row.contractStatus,
    creativeStatus: row.creativeStatus,
    creativeRound: row.creativeRound,
    creativeDocUrl: row.creativeDocUrl,
    creativeDocText: row.creativeDocText,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    erid: row.erid,
    eridAdvertiserData: row.eridAdvertiserData,
    postUrl: row.postUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    actReceivedAt: row.actReceivedAt?.toISOString() ?? null,
    stepMessages: row.stepMessages ?? null,
    eridSentAt: row.eridSentAt?.toISOString() ?? null,
    creativeClientComment: row.creativeClientComment,
    creativeClientSentAt: row.creativeClientSentAt?.toISOString() ?? null,
    metricsStatus: row.metricsStatus,
    metricsViews: row.metricsViews,
    metricsLikes: row.metricsLikes,
    metricsComments: row.metricsComments,
    metricsShares: row.metricsShares,
    metricsCollectedAt: row.metricsCollectedAt?.toISOString() ?? null,
    metricsError: row.metricsError,
    postSnapshot: row.postSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

// Склейка сабапов — порядок вызовов фиксирует порядок paths в openapi.json,
// не менять (контракт-дифф проверяется байт-в-байт).
app.route("/", offerApp);
app.route("/", productionApp);

export default app;

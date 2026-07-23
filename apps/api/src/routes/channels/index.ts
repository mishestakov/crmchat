// Каналы: CRUD, привязка админов и выбор способа связи (set-admin).
// Глобальный порядок регистрации роутов = порядок paths в openapi.json —
// сабапы (telegram/methods/import) подключаются строго в конце файла.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  CreateChannelSchema as BaseCreateChannel,
  parseChannelInput,
} from "@repo/core";
import { db } from "../../db/client.ts";
import { contactUsernameLowerSql } from "../../lib/contact-sql.ts";
import { isUniqueViolation } from "../../lib/errors.ts";
import { resolveMaxContactRef } from "../../lib/max-account-client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projectItems,
} from "../../db/schema.ts";
import {
  assertChannelAccess,
  channelAccessClause,
} from "../../lib/channels-access.ts";
import { ilikeContains } from "../../lib/ilike.ts";
import { contactAccessClause } from "../../lib/contacts-access.ts";
import { getOutreachWorkerClient } from "../../lib/outreach-account-client.ts";
import {
  clearPlacementRecipients,
  healPlacementRecipients,
} from "../../lib/placement-recipient.ts";
import { assertAccountAccess } from "../../lib/outreach-access.ts";
import {
  assertRole,
  type WorkspaceVars,
} from "../../middleware/assert-member.ts";
import {
  ChannelSchema,
  WsIdParam,
  WsParam,
  joinAdmins,
  pickMaxClient,
} from "./shared.ts";
import telegramApp, { isAccessibleGroup } from "./telegram.ts";
import methodsApp from "./methods.ts";
import importApp from "./import.ts";

const CreateChannelSchema = BaseCreateChannel.openapi("CreateChannel");

const WsIdContactParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
});

// Привязать админов можно двумя способами: contactIds — выбрать существующие
// контакты; usernames — добавить по @username (find-or-create stub-контакт, как
// при CSV-импорте). Это закрывает «контакта админа нет — добавить прямо здесь».
const AddAdminsBody = z
  .object({
    contactIds: z.array(z.string().min(1).max(64)).max(50).optional(),
    usernames: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine(
    (b) => (b.contactIds?.length ?? 0) + (b.usernames?.length ?? 0) > 0,
    { message: "укажите contactIds или usernames" },
  );

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Soft-limit на /channels: на 14k каналов фронт рендерит без боли, но
// уже на 100k+ JSON станет толстым. 1000 — компромисс: видно достаточно
// для оценки, а если каналов больше — юзер сужает поиском.
const CHANNELS_PAGE_LIMIT = 1000;

const ChannelsListQuery = z.object({
  q: z.string().max(200).optional(),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    request: { params: WsParam, query: ChannelsListQuery },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ChannelSchema) } },
        description: "Channels with admins (limit 1000, see CHANNELS_PAGE_LIMIT)",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const { q } = c.req.valid("query");
    // Поиск: ILIKE по title + username. Юзер вводит подстроку, regex не
    // нужен — ilikeContains эскейпит спецсимволы LIKE.
    const term = q?.trim();
    const searchClause = term
      ? sql`(${channels.title} ILIKE ${ilikeContains(term)} OR ${channels.username} ILIKE ${ilikeContains(term)})`
      : undefined;
    // Сортировка: member_count desc (NULLS LAST для не-засинканных) — топ
    // канал сверху, главный сигнал ценности; created_at — tie-breaker.
    const rows = await db
      .select()
      .from(channels)
      .where(and(channelAccessClause(wsId), searchClause))
      .orderBy(
        sql`${channels.memberCount} desc nulls last, ${channels.createdAt} desc`,
      )
      .limit(CHANNELS_PAGE_LIMIT);
    return c.json(await joinAdmins(rows));
  },
);

// Single-channel GET для карточки контакта: блок «Каналы» показывает табы
// по contact.channels[], клик по табу подгружает полный Channel.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel by id",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const channel = await assertChannelAccess(id, wsId);
    const [serialized] = await joinAdmins([channel]);
    return c.json(serialized!);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateChannelSchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const platform = body.platform ?? "telegram";

    let created: typeof channels.$inferSelect | undefined;
    try {
      [created] = await db
        .insert(channels)
        .values({
          workspaceId: wsId,
          platform,
          title: body.title,
          link: body.link ?? null,
          username: body.username ?? null,
          externalId: body.externalId ?? null,
          createdBy: userId,
        })
        .returning();
    } catch (e) {
      // Площадка с таким @username уже есть в воркспейсе (uniq ws+platform+
      // lower(username)). Не 500 — возвращаем существующую (менеджер её и искал).
      if (isUniqueViolation(e) && body.username) {
        const [existing] = await db
          .select()
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, wsId),
              eq(channels.platform, platform),
              sql`lower(${channels.username}) = lower(${body.username})`,
            ),
          )
          .limit(1);
        if (existing) {
          const [s] = await joinAdmins([existing]);
          return c.json(s!, 201);
        }
      }
      throw e;
    }
    if (!created) throw new HTTPException(500, { message: "insert failed" });

    if (body.adminContactIds?.length) {
      await db
        .insert(channelAdmins)
        .values(
          body.adminContactIds.map((contactId) => ({
            channelId: created.id,
            contactId,
          })),
        )
        .onConflictDoNothing();
    }

    const [serialized] = await joinAdmins([created]);
    return c.json(serialized!, 201);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsIdParam },
    responses: {
      204: { description: "Deleted" },
      409: { description: "Channel is used by placements" },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    // Гард целостности медиаплана: канал — накопительный актив, его удаление не
    // должно молча уносить размещения (цены, решения клиента, метрики) через
    // ON DELETE CASCADE. Есть placements на канал → 409, удалять нельзя.
    // channel_admins/subscriptions/thumbnails при удалении каскадят (не ценность).
    const [row] = await db
      .select({ used: count() })
      .from(projectItems)
      .where(
        and(eq(projectItems.channelId, id), eq(projectItems.workspaceId, wsId)),
      );
    const used = row?.used ?? 0;
    if (used > 0) {
      throw new HTTPException(409, {
        message: `channel is used by ${used} placement(s)`,
      });
    }
    await db
      .delete(channels)
      .where(and(eq(channels.id, id), eq(channels.workspaceId, wsId)));
    return c.body(null, 204);
  },
);

// Привязка контакт↔канал постфактум: каналы могли прийти из CSV без
// админов, а контакты автоподтянуться позже из живого трафика — нужен
// способ связать руками. Возвращает обновлённый channel (с актуальным
// admins[]) — фронт сразу патчит cache.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: { content: { "application/json": { schema: AddAdminsBody } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Admins added",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const { contactIds = [], usernames = [] } = c.req.valid("json");

    const channel = await assertChannelAccess(id, wsId);

    // Проверяем, что все contactIds доступны юзеру (а не просто принадлежат
    // workspace'у): member не должен прилинковать к каналу контакт коллеги,
    // которого сам видеть не вправе.
    if (contactIds.length > 0) {
      const valid = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(contactAccessClause(wsId), inArray(contacts.id, contactIds)));
      if (valid.length !== contactIds.length) {
        throw new HTTPException(400, {
          message: "some contacts are not accessible",
        });
      }
    }

    // usernames → find-or-create stub-контакт. parseChannelInput нормализует и
    // отбрасывает мусор (URL/«foo bar»/точки) — иначе в telegram_username
    // попадёт битый хэндл, который аутрич не зарезолвит. full_name = «@username»
    // до первого синка/трафика.
    const linkIds = [...contactIds];
    const norm = [
      ...new Set(
        usernames
          .map((u) => parseChannelInput(u).username)
          .filter((u): u is string => u !== null),
      ),
    ];
    if (norm.length > 0) {
      await db
        .insert(contacts)
        .values(
          norm.map((u) => ({
            workspaceId: wsId,
            properties: { telegram_username: u, full_name: `@${u}` },
            createdBy: userId,
          })),
        )
        .onConflictDoNothing();
      const found = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(contactUsernameLowerSql, norm),
          ),
        );
      linkIds.push(...found.map((f) => f.id));
    }

    if (linkIds.length > 0) {
      // Нашёлся человек — метод «персона» главнее external: снимаем внешний
      // способ и его stub-админа (заметки остаются на контакте stub'а). Иначе
      // два admin-row дают недетерминированный resolveAdminRecipient (limit 1
      // без order by) → возможна невидимая авто-отправка под маской «ручного»
      // лида (deriveOutreachState продолжал бы показывать manual_method).
      const wasExternal = isExternalMethod(channel);
      if (wasExternal) {
        await db.delete(channelAdmins).where(eq(channelAdmins.channelId, id));
        await db
          .update(channels)
          .set({ meta: sql`${channels.meta} - 'contact_method'` })
          .where(eq(channels.id, id));
      }
      await db
        .insert(channelAdmins)
        .values(linkIds.map((contactId) => ({ channelId: id, contactId })))
        .onConflictDoNothing();
      // Залечиваем размещения этого канала (этап 16.8): теперь у них есть
      // админ-получатель → чат и аутрич сразу заработают. После external —
      // override (размещения указывали на stub, non-override их не тронул бы);
      // clearScheduleOnly: авто-серию новому админу не взводим (как смена).
      await healPlacementRecipients(
        id,
        wasExternal ? { override: true, clearScheduleOnly: true } : {},
      );
    }

    const [serialized] = await joinAdmins([await assertChannelAccess(id, wsId)]);
    return c.json(serialized!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
    tags: ["channels"],
    request: { params: WsIdContactParam },
    responses: { 204: { description: "Admin removed" } },
  }),
  async (c) => {
    const { wsId, id, contactId } = c.req.valid("param");
    // Канал должен быть доступен этому юзеру (без проверки можно было бы
    // дёрнуть DELETE по подобранному channelId, в том числе чужому).
    const channel = await assertChannelAccess(id, wsId);
    await db
      .delete(channelAdmins)
      .where(
        and(
          eq(channelAdmins.channelId, id),
          eq(channelAdmins.contactId, contactId),
        ),
      );
    // Отвязали stub внешнего способа и админов не осталось → снимаем и сам
    // метод + получателей размещений: иначе contact_method='external' держал бы
    // contactReady=true вечно при «Не привязаны», лид завис бы в «Вручную»
    // вместо честного возврата в инбокс «Найти контакт».
    const wasExternal = isExternalMethod(channel);
    if (wasExternal) {
      const [left] = await db
        .select({ contactId: channelAdmins.contactId })
        .from(channelAdmins)
        .where(eq(channelAdmins.channelId, id))
        .limit(1);
      if (!left) {
        await db
          .update(channels)
          .set({ meta: sql`${channels.meta} - 'contact_method'` })
          .where(eq(channels.id, id));
        await clearPlacementRecipients(id);
      }
    }
    return c.body(null, 204);
  },
);

// Сменить способ связи канала (этап 16.8 / п.1) — глобально по каналу: один
// админ-получатель. Тело — ровно одно из: contactId (существующий контакт),
// username (контакт-stub по @), dm:true (личка канала, персону снимаем).
// Заменяет channel_admins и перенаводит ВСЕ размещения канала (см. scope-решение:
// «кто ведёт канал» — факт о канале, не о кампании).
// Текущий способ связи канала — external? (meta — нетипизированный jsonb.)
const isExternalMethod = (ch: { meta: unknown }): boolean =>
  (
    ((ch.meta ?? {}) as Record<string, unknown>).contact_method as
      | { kind?: string }
      | undefined
  )?.kind === "external";

const SetAdminBody = z
  .object({
    contactId: z.string().min(1).max(64).optional(),
    username: z.string().min(1).max(64).optional(),
    // MAX-админ: ссылка max.ru/u/<token> (длиннее 64) → контакт с
    // properties.max_link (модель получателя для отправки ЛС в MAX).
    maxLink: z.string().min(1).max(256).optional(),
    dm: z.boolean().optional(),
    // Способ связи = группа аккаунта (этап 16.9): chat_id группы + аккаунт-
    // участник (через него потом читаем/пишем).
    group: z
      .object({
        chatId: z.string().min(1).max(64),
        accountId: z.string().min(1).max(64),
      })
      .optional(),
    // Внешний способ связи (нет адаптера: Instagram/VK/WhatsApp/почта/…).
    // Свободный label + опц. ссылка. Авторассылки нет, прогресс ведётся
    // вручную (стадии канбана + заметки контакта). См. contact_method.kind.
    external: z
      .object({
        // trim на схеме: API-контракт не принимает whitespace-only (min(1)
        // после trim), как maxLink-путь, который тримит вручную.
        label: z.string().trim().min(1).max(80),
        // Нестрогая строка (не url()): менеджер может вписать «wa.me/…»,
        // «instagram.com/x» без протокола. Кликабельность решает фронт.
        link: z.string().trim().max(256).optional(),
      })
      .optional(),
  })
  .refine(
    (b) =>
      [b.contactId, b.username, b.maxLink, b.dm, b.group, b.external].filter(
        (v) => v != null && v !== false,
      ).length === 1,
    {
      message:
        "укажите ровно одно: contactId, username, maxLink, dm:true, group или external",
    },
  );

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/set-admin",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SetAdminBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Admin/contact-method set",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const body = c.req.valid("json");
    const channel = await assertChannelAccess(id, wsId);

    // maxLink — только для MAX-канала и только ссылка-профиль вида max.ru/u/<token>.
    // Иначе healPlacementRecipients(override) затёр бы TG-получателей null'ами
    // (resolveAdminRecipient не читает max_link), а кривая ссылка дала бы
    // неадресуемый stub-контакт.
    if (body.maxLink) {
      if (channel.platform !== "max") {
        throw new HTTPException(400, {
          message: "Ссылку MAX можно привязать только к MAX-каналу",
        });
      }
      if (!/max\.ru\/u\//i.test(body.maxLink)) {
        throw new HTTPException(400, {
          message: "Нужна ссылка получателя вида max.ru/u/<токен>",
        });
      }
    }

    if (body.group) {
      // Способ связи = группа: снимаем персону-получателя, в meta пишем chat_id
      // группы + аккаунт-участника (для чтения/отправки в G3). Готовность —
      // через contact_method.kind='group'.
      // Tenancy: аккаунт принадлежит воркспейсу и доступен пользователю (иначе
      // через него можно было бы читать/писать в чужие группы).
      await assertAccountAccess(body.group.accountId, wsId, userId, role);
      // Группа реально доступна аккаунту и это именно группа (не канал/привата) —
      // live getChat (offline для юзера). Нельзя привязать произвольный chat_id.
      const grpClient = await getOutreachWorkerClient({
        id: body.group.accountId,
        workspaceId: wsId,
      });
      if (!grpClient) {
        throw new HTTPException(503, { message: "tg client unavailable" });
      }
      if (!(await isAccessibleGroup(grpClient, Number(body.group.chatId)))) {
        throw new HTTPException(404, {
          message: "группа недоступна через этот аккаунт",
        });
      }
      await db.delete(channelAdmins).where(eq(channelAdmins.channelId, id));
      await clearPlacementRecipients(id);
      await db
        .update(channels)
        .set({
          // suggested_admin снимаем, как person/external-ветки: осознанный выбор
          // способа разрешает расхождение — иначе бейдж-предложение висит вечно,
          // а его «принять» молча стирает выбор «группа» (дрейф веток, аудит №4).
          meta: sql`(${channels.meta} - 'suggested_admin') || ${JSON.stringify({
            contact_method: {
              kind: "group",
              chat_id: body.group.chatId,
              account_id: body.group.accountId,
            },
          })}::jsonb`,
        })
        .where(eq(channels.id, id));
      const [serialized] = await joinAdmins([await assertChannelAccess(id, wsId)]);
      return c.json(serialized!);
    }

    if (body.dm) {
      // Способ связи = личка канала (этап 16.9): снимаем персону, помечаем
      // метод channel_dm — канал готов при любой цене (бесплатно → авто-логика,
      // платно → вручную). chat_id личка-группы берём из meta при отправке.
      await db.delete(channelAdmins).where(eq(channelAdmins.channelId, id));
      await clearPlacementRecipients(id);
      await db
        .update(channels)
        .set({
          // suggested_admin — как в group-ветке выше.
          meta: sql`(${channels.meta} - 'suggested_admin') || ${JSON.stringify({
            contact_method: { kind: "channel_dm" },
          })}::jsonb`,
        })
        .where(eq(channels.id, id));
      const [serialized] = await joinAdmins([await assertChannelAccess(id, wsId)]);
      return c.json(serialized!);
    }

    if (body.external) {
      // Внешний способ связи — нет адаптера (Instagram/VK/WhatsApp/почта/…).
      // Заводим stub-контакт под имя, чтобы к нему цеплялись заметки/напоминания
      // (activities) — «куда записывать результат». Метод external даёт
      // contactReady=true (готов), но авторассылки нет: username у stub'а null →
      // planner (prepareLeads/scheduleUnscheduledLeads) его пропускает. Прогресс
      // ведётся вручную: стадии канбана + заметки контакта.
      //
      // Дедуп stub'а: канал УЖЕ external → переиспользуем текущий контакт
      // (обновляем имя), а не мятим новый — иначе повторный сет (правка
      // опечатки в лейбле) осиротил бы заметки на прежнем stub'е.
      let stubId: string | null = null;
      if (isExternalMethod(channel)) {
        const [prior] = await db
          .select({ contactId: channelAdmins.contactId })
          .from(channelAdmins)
          .where(eq(channelAdmins.channelId, id))
          .limit(1);
        if (prior) {
          stubId = prior.contactId;
          await db
            .update(contacts)
            .set({
              properties: sql`${contacts.properties} || ${JSON.stringify({
                full_name: body.external.label,
              })}::jsonb`,
            })
            .where(eq(contacts.id, stubId));
        }
      }
      if (!stubId) {
        const [stub] = await db
          .insert(contacts)
          .values({
            workspaceId: wsId,
            properties: { full_name: body.external.label },
            createdBy: userId,
          })
          .returning({ id: contacts.id });
        stubId = stub!.id;
      }
      await db.delete(channelAdmins).where(eq(channelAdmins.channelId, id));
      await db
        .insert(channelAdmins)
        .values({ channelId: id, contactId: stubId })
        .onConflictDoNothing();
      // suggested_admin снимаем, как person-путь: осознанный выбор способа
      // разрешает расхождение — бейдж-предложение не должен висеть (и его
      // «принять» не должен провоцировать откат external).
      await db
        .update(channels)
        .set({
          meta: sql`(${channels.meta} - 'suggested_admin') || ${JSON.stringify({
            contact_method: {
              kind: "external",
              label: body.external.label,
              ...(body.external.link ? { link: body.external.link } : {}),
            },
          })}::jsonb`,
        })
        .where(eq(channels.id, id));
      // Перенаводим размещения на stub (contactId для заметок). clearScheduleOnly
      // ВСЕГДА: метод стал ручным → старую авто-серию гасим безусловно (в отличие
      // от repoint, который пропускает проекты без активных аккаунтов и мог бы
      // оставить stale-очередь), новую не планируем.
      await healPlacementRecipients(id, {
        override: true,
        clearScheduleOnly: true,
      });
      const [serialized] = await joinAdmins([await assertChannelAccess(id, wsId)]);
      return c.json(serialized!);
    }

    // Резолвим целевой контакт: существующий по id, MAX-stub по /u/-ссылке,
    // или stub по @username.
    let contactId = body.contactId ?? null;
    if (!contactId && body.maxLink) {
      const link = body.maxLink.trim();
      // Дедуп по properties.max_link (уникального индекса нет — select-then-insert).
      const [existing] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            sql`${contacts.properties} ->> 'max_link' = ${link}`,
          ),
        )
        .limit(1);
      if (existing) {
        contactId = existing.id;
      } else {
        // Резолвим /u/ через MAX-сессию: реальное имя + max_user_id (кешируем —
        // отправка/история не дёргают LINK_INFO повторно, он rate-limited).
        // Best-effort: нет сессии → подпись по токену, без max_user_id.
        let fullName = `MAX: ${link.replace(/.*\/u\//, "").slice(0, 8)}…`;
        let maxUserId: string | null = null;
        let avatarUrl: string | null = null;
        const picked = await pickMaxClient(wsId, userId, role);
        if (picked) {
          try {
            const r = await resolveMaxContactRef(picked.client, link);
            maxUserId = r.userId;
            if (r.name) fullName = r.name;
            avatarUrl = r.avatarUrl;
          } catch {
            /* best-effort — оставляем токен-подпись */
          }
        }
        const props: Record<string, unknown> = {
          max_link: link,
          full_name: fullName,
        };
        if (maxUserId) props.max_user_id = maxUserId;
        if (avatarUrl) props.max_avatar_url = avatarUrl;
        const [created] = await db
          .insert(contacts)
          .values({ workspaceId: wsId, properties: props, createdBy: userId })
          .returning({ id: contacts.id });
        contactId = created?.id ?? null;
      }
    }
    if (!contactId && body.username) {
      const uname = parseChannelInput(body.username).username;
      if (!uname) {
        throw new HTTPException(400, { message: "невалидный @username" });
      }
      await db
        .insert(contacts)
        .values({
          workspaceId: wsId,
          properties: { telegram_username: uname, full_name: `@${uname}` },
          createdBy: userId,
        })
        .onConflictDoNothing();
      const [found] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(contactUsernameLowerSql, [uname]),
          ),
        )
        .limit(1);
      contactId = found?.id ?? null;
    }
    if (!contactId) {
      throw new HTTPException(404, { message: "контакт не найден" });
    }
    // Tenancy: контакт принадлежит этому воркспейсу.
    const [ct] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, wsId)))
      .limit(1);
    if (!ct) {
      throw new HTTPException(404, {
        message: "контакт не найден в воркспейсе",
      });
    }

    // Был ли у канала уже привязан админ — тогда это «смена/переназначение», а
    // не первое назначение. На любой смене график прежнего обнуляем и новую
    // серию НЕ планируем (clearScheduleOnly) — рассылку новому менеджер запускает
    // вручную, без само-взвода пиналки на уже-продвинутых карточках. У канала
    // может быть НЕСКОЛЬКО админ-строк (составной PK) → проверяем сам факт
    // наличия, а не сравниваем с конкретным контактом (это было бы недетермини-
    // ровано на limit(1) без order by).
    const [prior] = await db
      .select({ contactId: channelAdmins.contactId })
      .from(channelAdmins)
      .where(eq(channelAdmins.channelId, id))
      .limit(1);
    const isAdminChange = !!prior;

    // Глобально по каналу: один админ-получатель (заменяем) + перенаводим все
    // размещения канала (override).
    await db.delete(channelAdmins).where(eq(channelAdmins.channelId, id));
    await db
      .insert(channelAdmins)
      .values({ channelId: id, contactId })
      .onConflictDoNothing();
    await healPlacementRecipients(id, {
      override: true,
      clearScheduleOnly: isAdminChange,
    });
    // Сбрасываем contact_method (теперь способ связи — человек/бот, не группа)
    // и снимаем предложение смены админа (suggested_admin) — осознанный set-admin
    // разрешает расхождение: либо приняли кандидата, либо выбрали своего.
    await db
      .update(channels)
      .set({ meta: sql`${channels.meta} - 'contact_method' - 'suggested_admin'` })
      .where(eq(channels.id, id));

    const [serialized] = await joinAdmins([await assertChannelAccess(id, wsId)]);
    return c.json(serialized!);
  },
);

// Склейка сабапов — порядок вызовов фиксирует порядок paths в openapi.json,
// не менять (контракт-дифф проверяется байт-в-байт).
app.route("/", telegramApp);
app.route("/", methodsApp);
app.route("/", importApp);

export default app;

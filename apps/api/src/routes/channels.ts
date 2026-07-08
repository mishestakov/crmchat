import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  type Channel,
  ChannelSchema as BaseChannelSchema,
  ChannelRelationStatusSchema,
  CreateChannelSchema as BaseCreateChannel,
  type FieldDef,
  ImportChannelsSchema as BaseImportChannels,
  ImportChannelsResultSchema as BaseImportResult,
  parseChannelInput,
} from "@repo/core";
import { db, sql as sqlClient } from "../db/client.ts";
import { contactUsernameLowerSql } from "../lib/contact-sql.ts";
import { median } from "../lib/median.ts";
import { errMsg, isUniqueViolation } from "../lib/errors.ts";
import {
  type TdContent,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
  extractFormattedText,
  extractMediaThumb,
  inputMessageText,
} from "../lib/td-message.ts";
import {
  fetchChannelHistory,
  mapChannelHistoryItems,
  readChannelPreview,
} from "../lib/channel-history.ts";
import { respondWithCreativeMedia } from "../lib/creative-media-response.ts";
import {
  loadChannelPropertyDefs,
  validateEntityProperties,
} from "../lib/entity-properties.ts";
import {
  isProviderPlatform,
  resolveChannelIdentifier,
  syncChannelFromProvider,
} from "../lib/channel-providers/index.ts";
import {
  fetchMaxPosts,
  joinMaxChannel,
  syncChannelFromMax,
  syncMaxChannelsBatch,
} from "../lib/channel-providers/max.ts";
import {
  getMaxWorkerClient,
  resolveMaxContactRef,
} from "../lib/max-account-client.ts";
import { pickMaxAccount } from "../lib/max-conversation.ts";
import type { MaxClient } from "../lib/max/index.ts";
import {
  channelAdmins,
  channelSubscriptions,
  channelThumbnails,
  channels,
  contacts,
  outreachAccounts,
  projectItems,
  projects,
  tgChats,
  tgUsers,
} from "../db/schema.ts";
import {
  assertChannelAccess,
  channelAccessClause,
} from "../lib/channels-access.ts";
import { channelIsRknSql } from "../lib/rkn-registry.ts";
import { ilikeContains } from "../lib/ilike.ts";
import { contactAccessClause } from "../lib/contacts-access.ts";
import {
  findSubscribedReaderAccount,
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
  setAccountCooldown,
} from "../lib/outreach-account-client.ts";
import {
  clearPlacementRecipients,
  healPlacementRecipients,
} from "../lib/placement-recipient.ts";
import { recordChannelRelation } from "../lib/channel-relation.ts";
import {
  accountAccessClause,
  assertAccountAccess,
} from "../lib/outreach-access.ts";
import {
  assertRole,
  type WorkspaceRole,
  type WorkspaceVars,
} from "../middleware/assert-member.ts";
import type { TdClient } from "../lib/tdlib/client.ts";

// Каналы читаются любым outreach-аккаунтом workspace'а — единственный
// TG-actor у нас. Берём первый available active доступный юзеру (RBAC через
// accountAccessClause), поднимаем worker'а если ещё не поднят.
//
// Round-robin / sticky канал→аккаунт не вводим: один аккаунт прочитает
// любой канал, thumbnail/member_count кешируется 24h. Если упрёмся в
// flood-лимиты — добавим выбор по нагрузке.
// Классификация TDLib/MTProto-ошибок resolve'а канала. Permanent = «канала
// действительно нет с точки зрения TG» — пишем в unavailable_*, перестаём
// дёргать TDLib (cooldown-gate ниже). Transient (FLOOD_WAIT, network, 5xx)
// просто throw — не помечаем, пусть юзер ретраит.
//
// Список patterns пополняется по факту: добавляем когда реально увидели в
// проде. core.telegram.org/api/errors имеет ещё CHANNEL_PRIVATE,
// USERNAME_INVALID, PEER_ID_INVALID — добавим если наткнёмся.
const PERMANENT_RESOLVE_PATTERNS = ["chat not found", "username_not_occupied"];

function classifyResolveError(
  e: unknown,
): { permanent: true; reason: string } | { permanent: false } {
  const raw = errMsg(e);
  const low = raw.toLowerCase();
  for (const p of PERMANENT_RESOLVE_PATTERNS) {
    if (low.includes(p)) return { permanent: true, reason: raw };
  }
  return { permanent: false };
}

async function markChannelUnavailable(
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: sql`coalesce(${channels.unavailableSince}, now())`,
      unavailableLastCheckAt: new Date(),
      unavailableReason: reason,
    })
    .where(eq(channels.id, id));
}

// Cooldown между retry-ями TDLib для unavailable-каналов. После провала ждём
// час — потом один шанс. «Нормальные клиенты не долбят туда где не
// существует». Юзер может бэк-флагом ?force=true сбить cooldown, если
// нужна immediate-проверка (кнопка «проверить сейчас» в UI).
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

function isInUnavailableCooldown(
  channel: typeof channels.$inferSelect,
): boolean {
  if (!channel.unavailableLastCheckAt) return false;
  return (
    Date.now() - channel.unavailableLastCheckAt.getTime() <
    UNAVAILABLE_COOLDOWN_MS
  );
}

async function clearChannelUnavailable(id: string): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: null,
      unavailableLastCheckAt: null,
      unavailableReason: null,
    })
    .where(eq(channels.id, id));
}

async function pickOutreachClient(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const [acc] = await db
    .select({ id: outreachAccounts.id, workspaceId: outreachAccounts.workspaceId })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  if (!acc) return null;
  const client = await getOutreachWorkerClient(acc);
  if (!client) return null;
  return { client, accountId: acc.id };
}

// Любой активный MAX-аккаунт workspace'а: публичные каналы MAX читаются без
// вступления, поэтому подписка не нужна (в отличие от приватных TG). Выбор
// аккаунта — общий pickMaxAccount; здесь поверх него поднимаем воркер-клиент.
async function pickMaxClient(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: MaxClient; accountId: string } | null> {
  const acc = await pickMaxAccount(wsId, userId, role);
  if (!acc) return null;
  try {
    const client = await getMaxWorkerClient(acc);
    return { client, accountId: acc.id };
  } catch {
    return null;
  }
}

// Выбор аккаунта для чтения канала. Приоритет: любой подписанный аккаунт
// workspace'a (для приватных каналов это единственный способ + позволяет
// команде читать через коллегин аккаунт). Fallback — мой собственный
// аккаунт (для публичных каналов работает без подписки, как раньше).
async function pickChannelReader(
  channelId: string,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const subscribed = await findSubscribedReaderAccount(wsId, channelId);
  if (subscribed) {
    const client = await getOutreachWorkerClient(subscribed);
    if (client) return { client, accountId: subscribed.id };
  }
  return pickOutreachClient(wsId, userId, role);
}

const ChannelSchema = BaseChannelSchema.openapi("Channel");
const CreateChannelSchema = BaseCreateChannel.openapi("CreateChannel");
const ImportChannelsSchema = BaseImportChannels.openapi("ImportChannels");
const ImportChannelsResultSchema = BaseImportResult.openapi(
  "ImportChannelsResult",
);

// Drizzle строит INSERT VALUES (a),(b),… через рекурсивный SQL-builder, на
// 10k+ строк падает в RangeError (call-stack). Бьём на куски ~500 — Postgres
// прожуёт каждый чанк за десятки мс, общий импорт остаётся в одном HTTP.
const INSERT_CHUNK = 500;
function chunks<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
});
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
      await db
        .insert(channelAdmins)
        .values(linkIds.map((contactId) => ({ channelId: id, contactId })))
        .onConflictDoNothing();
      // Залечиваем осиротевшие размещения этого канала (этап 16.8): теперь у
      // них есть админ-получатель → чат и аутрич сразу заработают.
      await healPlacementRecipients(id);
    }

    const [serialized] = await joinAdmins([channel]);
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
    await assertChannelAccess(id, wsId);
    await db
      .delete(channelAdmins)
      .where(
        and(
          eq(channelAdmins.channelId, id),
          eq(channelAdmins.contactId, contactId),
        ),
      );
    return c.body(null, 204);
  },
);

// Сменить способ связи канала (этап 16.8 / п.1) — глобально по каналу: один
// админ-получатель. Тело — ровно одно из: contactId (существующий контакт),
// username (контакт-stub по @), dm:true (личка канала, персону снимаем).
// Заменяет channel_admins и перенаводит ВСЕ размещения канала (см. scope-решение:
// «кто ведёт канал» — факт о канале, не о кампании).
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
  })
  .refine(
    (b) =>
      [b.contactId, b.username, b.maxLink, b.dm, b.group].filter(
        (v) => v != null && v !== false,
      ).length === 1,
    {
      message:
        "укажите ровно одно: contactId, username, maxLink, dm:true или group",
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
          meta: sql`${channels.meta} || ${JSON.stringify({
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
          meta: sql`${channels.meta} || ${JSON.stringify({
            contact_method: { kind: "channel_dm" },
          })}::jsonb`,
        })
        .where(eq(channels.id, id));
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

// TDLib chat object (нужные поля) для live-листинга групп.
type TdChatLite = {
  id: number;
  title: string;
  type: { _: string; is_channel?: boolean };
};

function isGroupChatType(t: TdChatLite["type"] | undefined): boolean {
  if (!t) return false;
  // Группа = basicGroup или supergroup-не-канал. Broadcast-канал (is_channel=
  // true), привата, секретные — не группы.
  return (
    t._ === "chatTypeBasicGroup" ||
    (t._ === "chatTypeSupergroup" && t.is_channel === false)
  );
}

// Проверка «chat_id — доступная аккаунту группа» (для валидации привязки).
// getChat — offline для юзер-аккаунта (td_api.tl §getChat), один in-memory вызов.
async function isAccessibleGroup(
  client: TdClient,
  chatId: number,
): Promise<boolean> {
  try {
    const ch = (await client.invoke({
      _: "getChat",
      chat_id: chatId,
    } as never)) as TdChatLite;
    return isGroupChatType(ch.type);
  } catch {
    return false;
  }
}

// Live-листинг групп аккаунта (этап 16.9 ревизия): без реплики в БД, и при этом
// БЕЗ единого MTProto-запроса — поэтому безопасно дёргать на поиск (флуда нет).
// Ресерч по исходникам TDLib (github.com/tdlib/td), чтобы вывод не потерялся:
//   • searchChats → Requests.cpp:3325 → MessagesManager::search_dialogs
//     (MessagesManager.cpp:14146): `dialogs_hints_.search(query, limit)` по
//     IN-MEMORY структуре + `promise.set_value(Unit())` синхронно — НИ ОДНОГО
//     сетевого запроса (td_api.tl: «This is an offline method»). Пустой query →
//     search_recently_found_dialogs (тоже локально).
//   • getChat для юзер-аккаунта — offline (td_api.tl §getChat: «offline method
//     if the current user is not a bot»), читает локальный Dialog.
//   • Сетевой вызов есть только у searchChatsOnServer (НЕ используем) и loadChats
//     (грузит чат-лист — это делает реплитор один раз на bootstrap, не на поиск).
// Отсюда: RAM-кэш всех групп — оверинжиниринг (нет сети → нечем флудить); поиск
// идёт прямо по offline-индексу TDLib, данные всегда актуальные.
async function listAccountGroups(
  client: TdClient,
  query: string,
): Promise<{ chatId: string; title: string }[]> {
  const res = (await client.invoke({
    _: "searchChats",
    query,
    limit: 50,
  } as never)) as { chat_ids?: number[] };
  const ids = res.chat_ids ?? [];
  const chats = await Promise.all(
    ids.map((cid) =>
      client
        .invoke({ _: "getChat", chat_id: cid } as never)
        .then((ch: unknown) => ch as TdChatLite)
        .catch(() => null),
    ),
  );
  const out: { chatId: string; title: string }[] = [];
  for (const ch of chats) {
    if (ch && isGroupChatType(ch.type)) {
      out.push({ chatId: String(ch.id), title: ch.title || "Без названия" });
    }
  }
  return out;
}

// Группы, в которых состоят доступные пользователю аккаунты (этап 16.9) —
// источник для пикера «привязать группу как способ связи». Читается LIVE
// через TDLib (без таблицы tg_groups): порядок main-list сохраняем, дедуп по
// chat_id (первый аккаунт-участник в порядке перебора).
const AccountGroupSchema = z
  .object({
    chatId: z.string(),
    title: z.string().nullable(),
    accountId: z.string(),
  })
  .openapi("AccountGroup");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/account-groups",
    tags: ["channels"],
    request: {
      params: WsParam,
      query: z.object({ q: z.string().max(128).optional() }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.array(AccountGroupSchema) },
        },
        description: "Groups the workspace accounts are members of",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const { q } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const accts = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(accountAccessClause(wsId, userId, role))
      .orderBy(outreachAccounts.createdAt);

    const seen = new Set<string>();
    const out: { chatId: string; title: string; accountId: string }[] = [];
    for (const a of accts) {
      if (out.length >= 50) break;
      const client = await getOutreachWorkerClient({ id: a.id, workspaceId: wsId });
      if (!client) continue;
      const groups = await listAccountGroups(client, q ?? "").catch(() => []);
      for (const g of groups) {
        if (seen.has(g.chatId)) continue;
        seen.add(g.chatId);
        out.push({ chatId: g.chatId, title: g.title, accountId: a.id });
      }
    }
    return c.json(out.slice(0, 50));
  },
);

// Окно расчёта охвата/ERR: до 500 постов И не старше 3 месяцев (sparse-каналы
// иначе тянут год-назад-посты со стухшей аудиторией). Глубокий проход по ленте
// делаем раз в сутки на канал (TTL по meta.metrics_at), не на каждое открытие.
const METRICS_MAX_POSTS = 500;
const METRICS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const METRICS_TTL_MS = 24 * 60 * 60 * 1000;

type TdHistMsg = {
  id: number;
  date: number;
  is_pinned?: boolean;
  interaction_info?: {
    view_count?: number;
    forward_count?: number;
    reply_info?: { reply_count?: number };
    reactions?: { reactions?: { total_count: number }[] };
  };
};

// Авто-метрики канала из ленты (этап 16.10): ср. охват = медиана просмотров по
// последним ~15 постам (без закрепа), ERR (by reach) = медиана по постам
// (реакции+репосты+комменты)/просмотры × 100. Чистая функция: считается из уже
// полученной /history-ленты (отдельного TDLib-вызова не нужно). Мало данных → null.
function metricsFromMessages(
  msgs: TdHistMsg[],
): { avgReach: number; err: number; sample: number } | null {
  // Только посты за последние 3 месяца: sparse-канал мог набрать 500 постов за
  // год — старую аудиторию в охват не берём (даже если fetch их зацепил).
  const minDateSec = (Date.now() - METRICS_WINDOW_MS) / 1000;
  const posts = msgs.filter(
    (m) =>
      !m.is_pinned &&
      m.date >= minDateSec &&
      typeof m.interaction_info?.view_count === "number" &&
      m.interaction_info.view_count > 0,
  );
  if (posts.length < 3) return null;
  // Считаем по всему окну (до 500 постов / 3 месяца), а не по 15 новейшим:
  // у частопостящих каналов 15 постов = пара часов, охват скакал. Медиана
  // робастна к выбросам.
  const recent = posts;
  // recent.length ≥ 3 здесь → median не вернёт null, но ?? 0 для типа.
  const avgReach = median(recent.map((m) => m.interaction_info!.view_count!)) ?? 0;
  const ers = recent.map((m) => {
    const ii = m.interaction_info!;
    const reactions = (ii.reactions?.reactions ?? []).reduce(
      (sum, r) => sum + r.total_count,
      0,
    );
    const eng =
      reactions + (ii.forward_count ?? 0) + (ii.reply_info?.reply_count ?? 0);
    return ii.view_count! > 0 ? eng / ii.view_count! : 0;
  });
  const err = (median(ers) ?? 0) * 100;
  return {
    avgReach: Math.round(avgReach),
    err: Math.round(err * 10) / 10,
    sample: recent.length,
  };
}

// Ядро sync'а карточки канала из TG: резолв (searchPublicChat/getChat →
// getSupergroupFullInfo) + запись типизированных колонок и meta. Дёргается
// HTTP-ручкой /sync и ленивым авто-синком в ChannelCard при открытии канала.
// Бросает при TDLib-провале (permanent → помечает канал unavailable).
// Возвращает обновлённую raw-строку channels (без joinAdmins-сериализации).
async function syncChannelFromTg(
  channel: typeof channels.$inferSelect,
  tdClient: TdClient,
): Promise<typeof channels.$inferSelect> {
  const id = channel.id;
  type TdChat = {
    id: number;
    title: string;
    type: { _: string; supergroup_id?: number; is_channel?: boolean };
    photo?: { minithumbnail?: { data: string } };
  };
  type TdSupergroupFullInfo = {
    description: string;
    member_count: number;
    linked_chat_id: number;
    direct_messages_chat_id: number;
    gift_count: number;
    outgoing_paid_message_star_count: number;
    photo?: { minithumbnail?: { data: string } };
  };

  // searchPublicChat — единственный способ зарегистрировать публичный чат в
  // TDLib-state без подписки. Только после него getSupergroupFullInfo и
  // getChatHistory получают chat (см. td_api.tl §searchPublicChat, §getChat —
  // offline-only). getChat(externalId) — fallback для каналов без @username.
  let tdChat: TdChat;
  try {
    tdChat = channel.username
      ? ((await tdClient.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never)) as TdChat)
      : ((await tdClient.invoke({
          _: "getChat",
          chat_id: Number(channel.externalId),
        } as never)) as TdChat);
  } catch (e) {
    const cls = classifyResolveError(e);
    if (cls.permanent) await markChannelUnavailable(id, cls.reason);
    throw new HTTPException(404, {
      message: `Telegram lookup failed: ${errMsg(e)}`,
    });
  }

  if (tdChat.type._ !== "chatTypeSupergroup" || !tdChat.type.supergroup_id) {
    throw new HTTPException(400, {
      message: `chat ${tdChat.id} is not a supergroup (got ${tdChat.type._})`,
    });
  }

  const supergroupId = tdChat.type.supergroup_id;
  // Race-fix: searchPublicChat выше эмитит updateSupergroup, replicator кладёт
  // patch в channelMetaBuf и взводит flush на 500ms. Если getSupergroupFullInfo
  // затянется и flush выстрелит до финального UPDATE — flush не найдёт row по
  // meta->>'supergroup_id'. Кладём supergroup_id заранее, чтобы flush попал.
  await db
    .update(channels)
    .set({
      meta: sql`${channels.meta} || ${JSON.stringify({ supergroup_id: String(supergroupId) })}::jsonb`,
    })
    .where(eq(channels.id, id));

  // getSupergroup НЕ вызываем — его поля (boost_level, has_dm, …) прилетают как
  // updateSupergroup в tg-replicator.ts. FullInfo без явного invoke не приходит.
  let tdFull: TdSupergroupFullInfo;
  try {
    tdFull = (await tdClient.invoke({
      _: "getSupergroupFullInfo",
      supergroup_id: supergroupId,
    } as never)) as TdSupergroupFullInfo;
  } catch (e) {
    const cls = classifyResolveError(e);
    if (cls.permanent) await markChannelUnavailable(id, cls.reason);
    throw new HTTPException(404, {
      message: `Telegram lookup failed: ${errMsg(e)}`,
    });
  }

  // Только свои поля; nice-to-have от updateSupergroup доедут merge'ем.
  const metaPatch: Record<string, unknown> = {
    supergroup_id: String(supergroupId),
    linked_chat_id: tdFull.linked_chat_id || null,
    direct_messages_chat_id: tdFull.direct_messages_chat_id || null,
    gift_count: tdFull.gift_count,
    outgoing_paid_message_star_count: tdFull.outgoing_paid_message_star_count,
  };

  const description = tdFull.description || null;
  const externalIdNew = String(tdChat.id);

  // Thumbnail: chat.photo.minithumbnail.data приходит как base64-строка. Нет
  // аватара — поле photo отсутствует, прежний кеш не сносим.
  const minithumb =
    tdChat.photo?.minithumbnail?.data ?? tdFull.photo?.minithumbnail?.data;
  const [[updated]] = await Promise.all([
    db
      .update(channels)
      .set({
        externalId: externalIdNew,
        title: tdChat.title || channel.title,
        description,
        memberCount: tdFull.member_count,
        meta: sql`${channels.meta} || ${JSON.stringify(metaPatch)}::jsonb`,
        syncedAt: new Date(),
        updatedAt: new Date(),
        unavailableSince: null,
        unavailableLastCheckAt: null,
        unavailableReason: null,
      })
      .where(eq(channels.id, id))
      .returning(),
    minithumb
      ? db
          .insert(channelThumbnails)
          .values({ channelId: id, b64: minithumb })
          .onConflictDoUpdate({
            target: channelThumbnails.channelId,
            set: { b64: minithumb, updatedAt: new Date() },
          })
      : Promise.resolve(),
  ]);
  return updated!;
}

// Pull свежей карточки канала из TG. Lazy: фронт дёргает при открытии
// drawer'а если synced_at IS NULL или > 24h.
//
// Цепочка:
//   - если есть external_id → getChat(id)
//   - иначе по username → searchPublicChat(username) → Chat (с id)
//   - getSupergroup + getSupergroupFullInfo (только chatTypeSupergroup;
//     private/group/bot → 400)
// Запись: типизированные колонки + meta (REPLACE целиком) + synced_at.
// properties и admins не трогаем. Thumbnail (chat.photo.minithumbnail) →
// channel_thumbnails.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/sync",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      // ?force=true — кнопка «проверить сейчас» в UI: пропустить cooldown-gate
      // и сходить в TDLib даже если канал помечен недоступным <1h назад.
      query: z.object({ force: z.coerce.boolean().optional() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel synced from TG",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    // YouTube/TikTok: внешний HTTP-провайдер (не TDLib, аккаунт не нужен).
    // Кэш = synced_at, TTL 1ч: свежий канал не дёргаем в апиху, если не force.
    if (isProviderPlatform(channel.platform)) {
      const SYNC_TTL_MS = 60 * 60 * 1000;
      const fresh =
        !force &&
        channel.syncedAt != null &&
        Date.now() - channel.syncedAt.getTime() < SYNC_TTL_MS;
      const row = fresh ? channel : await syncChannelFromProvider(channel);
      const [serialized] = await joinAdmins([row]);
      return c.json(serialized!);
    }

    // MAX: читается через аккаунт-сессию (как TG), но подписка не нужна —
    // публичные каналы видны любому авторизованному MAX-аккаунту workspace'а.
    if (channel.platform === "max") {
      const picked = await pickMaxClient(wsId, userId, role);
      if (!picked) {
        throw new HTTPException(412, {
          message:
            "no active MAX account available — connect one in /outreach/accounts/new",
        });
      }
      const updated = await syncChannelFromMax(
        channel,
        picked.client,
        picked.accountId,
      );
      const [serialized] = await joinAdmins([updated]);
      return c.json(serialized!);
    }

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: `sync supported only for platform=telegram (got ${channel.platform})`,
      });
    }
    if (!channel.externalId && !channel.username) {
      throw new HTTPException(400, {
        message: "channel has neither external_id nor username; nothing to look up",
      });
    }
    // Cooldown-gate: канал помечен недоступным <1h назад → не идём в TDLib,
    // если только не передали ?force=true (кнопка «проверить сейчас» в UI).
    if (!force && isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    const picked = await pickOutreachClient(wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    const updated = await syncChannelFromTg(channel, tdClient);
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// Вступить в закрытый MAX-канал (кнопка «Вступить»): CHAT_JOIN по ссылке →
// channel_subscriptions, затем re-sync (теперь участник → подтянутся reach/посты,
// mx_pending снимется). Аккаунт MAX выбираем сами (pickMaxClient).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/max-subscribe",
    tags: ["channels"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Joined MAX channel (subscribed or pending approval)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "max") {
      throw new HTTPException(400, { message: "только для MAX-каналов" });
    }
    const picked = await pickMaxClient(wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, { message: "нет активного MAX-аккаунта" });
    }
    await joinMaxChannel(picked.client, channel, picked.accountId);
    const updated = await syncChannelFromMax(
      channel,
      picked.client,
      picked.accountId,
    );
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// Подписать аккаунт workspace'a на канал. Публичный канал (есть @) идёт
// через joinChat(chat_id); приватный (только invite-link типа t.me/+abc)
// — через joinChatByInviteLink. Read history после подписки идёт через
// этот аккаунт (см. GET /channels/{id}/history). Команда видит подписки
// друг друга — один подписанный = читают все.
//
// `INVITE_REQUEST_SENT` (закрытый канал, нужно подтверждение админа) →
// сохраняем status=pending, read через такой аккаунт ещё не работает.
const SubscribeBody = z.object({ accountId: z.string().min(1).max(64) });

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/subscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Subscribed (or pending approval)" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "subscribe supported only for platform=telegram",
      });
    }
    // Право подписки = право write через аккаунт. Member может подписать
    // только свои аккаунты, admin — любой в workspace'е.
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
          eq(outreachAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    // Резолв chat_id перед joinChat. Для импортированных каналов externalId
    // может быть null (CSV без явного chat_id) — в этом случае идём через
    // searchPublicChat (public) или joinChatByInviteLink (private, который
    // сам возвращает Chat с id). После резолва сохраняем externalId — без
    // этого getChatHistory упадёт на NaN.
    let resolvedChatId: number | null = channel.externalId
      ? Number(channel.externalId)
      : null;
    let status: "subscribed" | "pending" = "subscribed";
    try {
      if (channel.username && !resolvedChatId) {
        const tdChat = (await client.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      }
      if (resolvedChatId) {
        await client.invoke({
          _: "joinChat",
          chat_id: resolvedChatId,
        } as never);
      } else if (channel.link) {
        const tdChat = (await client.invoke({
          _: "joinChatByInviteLink",
          invite_link: channel.link,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      } else {
        throw new HTTPException(400, {
          message: "channel has neither @username nor invite link",
        });
      }
    } catch (e) {
      const msg = errMsg(e);
      // TDLib возвращает специальное сообщение когда канал требует одобрения
      // (см. td_api.tl §joinChat: «May return an error with a message
      // INVITE_REQUEST_SENT if only a join request was created»).
      if (msg.includes("INVITE_REQUEST_SENT")) {
        status = "pending";
      } else {
        throw new HTTPException(400, { message: msg });
      }
    }

    if (resolvedChatId && !channel.externalId) {
      await db
        .update(channels)
        .set({ externalId: String(resolvedChatId) })
        .where(eq(channels.id, id));
    }

    await db
      .insert(channelSubscriptions)
      .values({ accountId, channelId: id, status })
      .onConflictDoUpdate({
        target: [channelSubscriptions.accountId, channelSubscriptions.channelId],
        set: { status, subscribedAt: new Date() },
      });

    return c.body(null, 204);
  },
);

// Отписать аккаунт. Если других подписанных нет — приватный канал станет
// недоступен для read'a команды. UX-предупреждение делается на фронте.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/unsubscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Unsubscribed" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (client && channel.externalId) {
      try {
        await client.invoke({
          _: "leaveChat",
          chat_id: Number(channel.externalId),
        } as never);
      } catch (e) {
        // Если уже не подписан в TG — продолжаем чистить нашу запись.
        console.error(`[channels/unsubscribe] leaveChat:`, errMsg(e));
      }
    }
    await db
      .delete(channelSubscriptions)
      .where(
        and(
          eq(channelSubscriptions.accountId, accountId),
          eq(channelSubscriptions.channelId, id),
        ),
      );

    return c.body(null, 204);
  },
);

// PATCH /channels/{id} — редактирование «наших» полей.
// - username: админ переименовал канал, мы поправили @ и заново резолвим. На
//   смене сбрасываем unavailable_*-флаги, чтобы next sync не упёрся в cooldown
//   (новый @ — это логически уже другой чат).
// - properties: значения кастом-полей канала (ниша, cpc/cpa-бакет и т.п.).
//   Валидируются против каталога; null/""/[] удаляют ключ, остальное мерджится.
const PatchChannelSchema = z.object({
  username: z.string().min(1).max(64).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: PatchChannelSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel updated",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const channel = await assertChannelAccess(id, wsId);
    const body = c.req.valid("json");

    // Юзер может ввести «@channelname» или «channelname» — нормализуем.
    let nextUsername = channel.username;
    if (body.username !== undefined) {
      nextUsername = body.username
        ? body.username.replace(/^@/, "").trim() || null
        : null;
    }
    const usernameChanged = nextUsername !== channel.username;

    // properties: валидируем по каталогу канала и мерджим поверх существующих
    // (null/""/[] → удалить ключ). Не трогаем, если в body их нет.
    let nextProperties = channel.properties;
    if (body.properties !== undefined) {
      const merged = { ...channel.properties };
      for (const [k, v] of Object.entries(body.properties)) {
        if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
          delete merged[k];
        }
      }
      const defs = await loadChannelPropertyDefs(wsId);
      Object.assign(merged, validateEntityProperties(defs, body.properties));
      nextProperties = merged;
    }

    const [updated] = await db
      .update(channels)
      .set({
        username: nextUsername,
        properties: nextProperties,
        updatedAt: new Date(),
        // Username сменился — сбрасываем флаг недоступности и forced
        // повторный resolve. Делаем здесь, не в frontend, чтобы инвариант
        // «новый @ = новый канал к проверке» не зависел от UI.
        ...(usernameChanged
          ? {
              unavailableSince: null,
              unavailableLastCheckAt: null,
              unavailableReason: null,
              syncedAt: null,
            }
          : {}),
      })
      .where(eq(channels.id, id))
      .returning();
    const [serialized] = await joinAdmins([updated!]);
    return c.json(serialized!);
  },
);

// Статус взаимодействия по каналу (глобальный, следует за каналом по всем
// проектам) — смена статуса + комментарий-причина. Append-only: каждое
// нажатие добавляет запись в relationHistory и обновляет relationStatus
// (снимок). Доступно member'у. Запись без смены статуса = просто комментарий
// (status повторяет текущий).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/relation",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              status: ChannelRelationStatusSchema,
              note: z.string().max(2000).nullable(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Relation status recorded",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    await assertChannelAccess(id, wsId);
    const { status, note } = c.req.valid("json");
    const updated = await recordChannelRelation(id, status, note, c.get("userId"));
    // Канал мог исчезнуть между assertChannelAccess и UPDATE (гонка с удалением) —
    // returning() придёт пустым. Без гарда joinAdmins([undefined]) упал бы 500.
    if (!updated) throw new HTTPException(404, { message: "канал не найден" });
    const [serialized] = await joinAdmins([updated]);
    return c.json(serialized!);
  },
);

// История канала: последние N сообщений (plain-text), через personal-TDLib.
// Не-текст (фото/видео/forward) → "[медиа]"; этого достаточно для оценки
// активности канала, full-render медиа — отдельная задача.
//
// Pagination: from_message_id=0 на первой странице (TDLib возвращает с
// last сообщения). На дальнейших передаём id последнего полученного.
const ChannelHistoryQuery = z.object({
  // string, не number: MAX-id сообщений > MAX_SAFE_INTEGER (≈1.16e17) — coerce
  // в number валит валидацию (too_big) и теряет точность. regex ^\d+$ держит
  // инвариант «неотрицательное целое» на краю (режет abc/-5 → 400), но без
  // safe-int-кэпа. TG-ветка парсит Number() сама, MAX-ветка отдаёт [].
  fromMessageId: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ChannelHistoryReaction = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
});
const ChannelHistoryItem = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
  // full-res дескриптор (фото/видео-постер); байты — через post-media роут по
  // id сообщения. null если медиа нет. Блюр-thumb остаётся placeholder'ом.
  media: z
    .object({
      kind: z.enum(["photo", "video"]),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable(),
  // Прямой CDN-URL медиа (MAX). TG отдаёт байты через post-media/{id} прокси,
  // поэтому для TG здесь null — рендер выбирает источник по наличию mediaUrl.
  mediaUrl: z.string().nullable(),
  // messageInteractionInfo (td_api.tl:2730). У постов в каналах view_count
  // почти всегда есть; forward_count и replies — опционально (репост только
  // если кто-то форварднул, replies — только если у канала есть linked-чат).
  views: z.number().int().nonnegative().nullable(),
  forwards: z.number().int().nonnegative().nullable(),
  replies: z.number().int().nonnegative().nullable(),
  // Только реакции на стандартные emoji. Custom-emoji (premium) и paid-reactions
  // скипаем — без download custom-emoji не отрендерим, они станут '?'.
  reactions: z.array(ChannelHistoryReaction),
  isForwarded: z.boolean(),
});
const ChannelHistoryResponse = z.object({
  messages: z.array(ChannelHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/history",
    tags: ["channels"],
    request: { params: WsIdParam, query: ChannelHistoryQuery },
    responses: {
      200: {
        content: {
          "application/json": { schema: ChannelHistoryResponse },
        },
        description: "Last N messages of the channel (plain-text)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { fromMessageId, limit } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    // MAX: лента постов через CHAT_HISTORY (тот же контракт ответа, что TG).
    // Пагинация по времени пока не делаем — на 2-й странице (fromMessageId)
    // отдаём пусто. v1: последние N постов.
    if (channel.platform === "max") {
      if (!channel.externalId) {
        throw new HTTPException(412, {
          message: "channel not synced yet — POST /sync first",
        });
      }
      if (fromMessageId) return c.json({ messages: [] });
      const picked = await pickMaxClient(wsId, userId, role);
      if (!picked) {
        throw new HTTPException(412, {
          message: "no active MAX account available",
        });
      }
      const messages = await fetchMaxPosts(picked.client, channel.externalId, limit);
      return c.json({ messages });
    }

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "history supported only for platform=telegram",
      });
    }
    if (!channel.externalId) {
      throw new HTTPException(412, {
        message:
          "channel not synced yet — POST /sync first (resolves chat_id from username)",
      });
    }
    if (isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    // Приватный канал (нет @username) можно прочитать только подписанным
    // аккаунтом — TDLib без подписки отдаст «Chat not found». Явный 412
    // с маркером, чтобы фронт показал плашку «Подписаться».
    if (!channel.username) {
      const [anySub] = await db
        .select({ accountId: channelSubscriptions.accountId })
        .from(channelSubscriptions)
        .innerJoin(
          outreachAccounts,
          eq(outreachAccounts.id, channelSubscriptions.accountId),
        )
        .where(
          and(
            eq(channelSubscriptions.channelId, id),
            eq(channelSubscriptions.status, "subscribed"),
            eq(outreachAccounts.workspaceId, wsId),
            eq(outreachAccounts.status, "active"),
          ),
        )
        .limit(1);
      if (!anySub) {
        throw new HTTPException(412, {
          message: "subscription required to read private channel",
        });
      }
    }

    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    const chatId = Number(channel.externalId);

    // Прогрев state'а на каждый запрос: searchPublicChat кладёт чат в TDLib
    // memory state (см. td_api.tl §searchPublicChat — гарантирует updateNewChat
    // до возврата). Без него getChatHistory упадёт «Chat not found» в холодной
    // сессии (после рестарта api). Если username нет — пропускаем, надеемся
    // что чат уже зарегистрирован (например через подписку юзера).
    if (channel.username) {
      try {
        await tdClient.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never);
      } catch (e) {
        const cls = classifyResolveError(e);
        if (cls.permanent) await markChannelUnavailable(id, cls.reason);
        throw new HTTPException(404, {
          message: `Telegram lookup failed: ${errMsg(e)}`,
        });
      }
    }

    // Сетевое чтение ленты (openChat → backfill-loop getChatHistory → closeChat)
    // вынесено в lib/channel-history.fetchChannelHistory — тот же код тянет
    // превью канала. Здесь оборачиваем классификацией ошибок: permanent →
    // помечаем канал недоступным, иначе 404.
    // Вариант Б: глубокий проход по ленте (до 500 постов / 3 месяца) ради метрик
    // делаем только когда они устарели (раз в сутки на канал по meta.metrics_at),
    // иначе тянем ленту обычной порцией. Метрики считаем лишь на первой странице.
    const isFirstPage = fromMessageId === undefined;
    const metaAt = (channel.meta as Record<string, unknown>).metrics_at;
    const parsedAt = typeof metaAt === "string" ? Date.parse(metaAt) : NaN;
    // Нет маркера или он битый (NaN) → считаем устаревшим, надо пройтись.
    const metricsStale =
      !Number.isFinite(parsedAt) || Date.now() - parsedAt > METRICS_TTL_MS;
    const deepMetrics = isFirstPage && metricsStale;

    let aggregated;
    try {
      aggregated = await fetchChannelHistory(tdClient, {
        chatId,
        limit: deepMetrics ? METRICS_MAX_POSTS : limit,
        maxAgeMs: deepMetrics ? METRICS_WINDOW_MS : undefined,
        fromMessageId: fromMessageId ? Number(fromMessageId) : undefined,
      });
    } catch (e) {
      const cls = classifyResolveError(e);
      if (cls.permanent) await markChannelUnavailable(id, cls.reason);
      throw new HTTPException(404, {
        message: `history fetch failed: ${errMsg(e)}`,
      });
    }

    // Дошли сюда — TDLib отдал историю, канал точно доступен. Сбрасываем
    // unavailable-флаг, если ранее был выставлен (например, прошлый sync
    // упал, юзер переподключил аккаунт, теперь чат резолвится).
    if (channel.unavailableSince) {
      await clearChannelUnavailable(id);
    }

    // Фронту отдаём первые limit; при глубоком проходе набрали больше — это
    // только для расчёта охвата, лента остаётся постраничной.
    const items = mapChannelHistoryItems(aggregated.slice(0, limit), {
      withMedia: true,
    });

    // Авто-метрики из этой же ленты (этап 16.10) — без отдельного TDLib-вызова.
    // Пишем в meta: центр и правый рельс показывают, «Согласован» снапшотит в
    // прогноз. Только при deepMetrics (первая страница + устаревшие метрики).
    const metrics = deepMetrics ? metricsFromMessages(aggregated) : null;
    if (deepMetrics) {
      // metrics_at — TTL-маркер «когда последний раз глубоко проходили». Пишем
      // ВСЕГДА при deepMetrics, даже если метрик не набралось (sparse-канал:
      // постов в окне меньше порога → metricsFromMessages === null). Иначе
      // metricsStale остаётся true и мы лезем в глубокий проход на КАЖДОМ
      // открытии первой страницы. Маркер = «проверили, до TTL не лезем снова».
      const patch: Record<string, unknown> = {
        metrics_at: new Date().toISOString(),
      };
      if (metrics) {
        patch.avg_reach = metrics.avgReach;
        patch.err = metrics.err;
        patch.metrics_sample = metrics.sample;
      }
      await db
        .update(channels)
        .set({ meta: sql`${channels.meta} || ${JSON.stringify(patch)}::jsonb` })
        .where(eq(channels.id, id));
    }

    return c.json({ messages: items });
  },
);

// История размещений канала (срез 4): агрегат project_items по channelId через
// ВСЕ кампании воркспейса — «за сколько этот канал размещали раньше». Канал —
// накопительный актив (единый источник цены = placement, отдельной сущности
// истории нет), поэтому просто читаем прошлые сделки. Показываем только те, где
// была цена; текущее размещение исключаем через excludeId.
const PlacementHistoryItem = z.object({
  placementId: z.string(),
  projectId: z.string(),
  campaignName: z.string(),
  // publishedAt ?? scheduledAt ?? createdAt — когда размещение было/заведено.
  date: z.iso.datetime(),
  priceAmount: z.number().nullable(),
  // Условия сделки — чтобы «подставить» в новом размещении тянуло не только цену.
  surchargePercent: z.number().nullable(),
  bloggerVat: z.boolean(),
  format: z.string().nullable(),
});
const PlacementHistoryResponse = z.object({
  items: z.array(PlacementHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/placement-history",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        // Исключить текущее размещение (чтобы своя же строка не попала в историю).
        excludeId: z.string().min(1).max(64).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: PlacementHistoryResponse },
        },
        description: "Past placements of this channel across campaigns",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { excludeId, limit } = c.req.valid("query");
    await assertChannelAccess(id, wsId);
    const dateExpr = sql`COALESCE(${projectItems.publishedAt}, ${projectItems.scheduledAt}, ${projectItems.createdAt})`;
    const rows = await db
      .select({
        placementId: projectItems.id,
        projectId: projectItems.projectId,
        campaignName: projects.name,
        priceAmount: projectItems.priceAmount,
        surchargePercent: projectItems.surchargePercent,
        bloggerVat: projectItems.bloggerVat,
        format: projectItems.format,
        publishedAt: projectItems.publishedAt,
        scheduledAt: projectItems.scheduledAt,
        createdAt: projectItems.createdAt,
      })
      .from(projectItems)
      .innerJoin(projects, eq(projects.id, projectItems.projectId))
      .where(
        and(
          eq(projectItems.channelId, id),
          eq(projectItems.workspaceId, wsId),
          isNotNull(projectItems.priceAmount),
          excludeId ? ne(projectItems.id, excludeId) : undefined,
        ),
      )
      .orderBy(desc(dateExpr))
      .limit(limit);
    const items = rows.map((r) => ({
      placementId: r.placementId,
      projectId: r.projectId,
      campaignName: r.campaignName,
      date: (r.publishedAt ?? r.scheduledAt ?? r.createdAt).toISOString(),
      priceAmount: r.priceAmount === null ? null : Number(r.priceAmount),
      surchargePercent:
        r.surchargePercent === null ? null : Number(r.surchargePercent),
      bloggerVat: r.bloggerVat,
      format: r.format,
    }));
    return c.json({ items });
  },
);

// Байты медиа поста канала (full-res) — плейн-роут (бинарь). Скачиваем on-demand
// по messageId (фронт берёт его из ленты), не храним. Блюр-thumb на фронте —
// мгновенный placeholder, это грузится лениво поверх.
app.get(
  "/v1/workspaces/:wsId/channels/:id/post-media/:messageId",
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const id = c.req.param("id");
    const messageId = c.req.param("messageId");
    const channel = await assertChannelAccess(id, wsId);
    if (!channel.externalId) {
      throw new HTTPException(404, { message: "not synced" });
    }
    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) throw new HTTPException(404, { message: "no reader" });
    // БЕЗ searchPublicChat-прогрева: картинку грузят из уже открытой ленты
    // (/history его сделал), чат зарегистрирован в сессии. Холодный прямой
    // доступ (без ленты) — редкость, просто не отдаст медиа (фронт → блюр).
    return respondWithCreativeMedia(
      picked.client,
      { chatId: String(channel.externalId), messageId, albumId: null },
      0,
    );
  },
);

// Бережный предпросмотр канала (этап 16.10): посты ТОЛЬКО из локального кэша
// TDLib (only_local) — ноль MTProto-запросов, не флудим на согласовании. Пусто,
// Предпросмотр канала (этап 16.10): лёгкая версия /history без метрик. Тянет
// ленту с сервера (readChannelPreview), т.к. only_local отдавал 1 пост из-за
// per-account кэша. Ошибка → [] (дровер не падает). Те же посты видит клиент.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/preview",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelHistoryResponse } },
        description: "Channel posts feed (network read, errors → empty)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { limit } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "telegram" || !channel.externalId) {
      return c.json({ messages: [] });
    }
    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) return c.json({ messages: [] });
    const msgs = await readChannelPreview(picked.client, {
      chatId: Number(channel.externalId),
      username: channel.username,
      limit,
    });
    return c.json({ messages: mapChannelHistoryItems(msgs) });
  },
);

// Выбор активного аккаунта workspace'а БЕЗ подъёма TdClient (только id) —
// клиент всё равно поднимается ниже в ручке, незачем бутить дважды.
async function pickActiveAccountId(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<string | null> {
  const [acc] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  return acc?.id ?? null;
}

// Аккаунт-«хозяин» лички канала. В личка-группе канала у КАЖДОГО аккаунта свой
// per-sender топик, поэтому чтение и отправка обязаны идти через один аккаунт —
// иначе тред раздваивается (ответ уходит от другого имени в отдельную
// переписку). Закрепляем первый написавший аккаунт в meta.dm_account_id и
// держимся за него, пока он существует. Тенанси по нему — как у группы: ручка
// зовёт assertAccountAccess (404 для чужого аккаунта не-админу).
async function resolveDmAccountId(
  channel: typeof channels.$inferSelect,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<string | null> {
  const meta = (channel.meta ?? {}) as Record<string, unknown>;
  const pinned =
    typeof meta.dm_account_id === "string" ? meta.dm_account_id : null;
  if (pinned) {
    const [exists] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, pinned),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (exists) return pinned;
  }
  const picked = await pickActiveAccountId(wsId, userId, role);
  if (!picked) return null;
  if (picked !== pinned) {
    await db
      .update(channels)
      .set({
        meta: sql`${channels.meta} || jsonb_build_object('dm_account_id', ${picked}::text)`,
      })
      .where(eq(channels.id, channel.id));
  }
  return picked;
}

// Чат «способа связи через чат» (этап 16.9): читаем/пишем историю группы
// обсуждения ИЛИ лички канала через аккаунт-участника. В отличие от /history
// (broadcast-канал) — сообщения от разных участников, поэтому возвращаем
// senderName на каждом.
//
// `target` задаёт намерение вызывающего и разрешается ОДНОЗНАЧНО — каждая точка
// входа ведёт ровно туда, что на ней написано (каталоговая «личка» != группа):
//   • "group" — chat_id + аккаунт-участник из meta.contact_method (их кладёт
//     set-admin при выборе группы; вывести из канала их нельзя).
//   • "dm" — личка-группа канала (meta.direct_messages_chat_id, кладёт sync);
//     sendMessage туда = как в обычную группу; аккаунт закреплён (resolveDmAccountId).
//   • undefined — дефолт по факту выбранного способа (группа если выбрана, иначе
//     личка) — для совместимости; новые вызовы передают target явно.
// dmStarCost != null → платная личка: чтение разрешаем, отправку блокирует
// вызывающий (платное = вручную, см. spec §16.9).
async function resolveMethodChat(
  channel: typeof channels.$inferSelect,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
  target?: "group" | "dm",
): Promise<{ chatId: number; accountId: string; dmStarCost: number | null }> {
  const meta = (channel.meta ?? {}) as Record<string, unknown>;
  const cm = meta.contact_method as
    | { kind?: string; chat_id?: string | number; account_id?: string }
    | undefined;
  const wantGroup =
    target === "group" || (target === undefined && cm?.kind === "group");
  if (wantGroup) {
    if (cm?.kind === "group" && cm.chat_id != null && cm.account_id) {
      return {
        chatId: Number(cm.chat_id),
        accountId: cm.account_id,
        dmStarCost: null,
      };
    }
    throw new HTTPException(400, {
      message: "у канала не выбрана группа как способ связи",
    });
  }
  const dmChatId = meta.direct_messages_chat_id;
  if (dmChatId != null && String(dmChatId) !== "0") {
    const accountId = await resolveDmAccountId(channel, wsId, userId, role);
    if (!accountId) {
      throw new HTTPException(503, {
        message: "нет активного Telegram-аккаунта для лички канала",
      });
    }
    const star =
      typeof meta.outgoing_paid_message_star_count === "number"
        ? meta.outgoing_paid_message_star_count
        : null;
    return { chatId: Number(dmChatId), accountId, dmStarCost: star };
  }
  throw new HTTPException(400, {
    message: "у канала не выбран способ связи через чат (группа/личка)",
  });
}

const GroupHistoryItem = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  text: z.string(),
  isOutgoing: z.boolean(),
  senderName: z.string(),
});
const GroupHistoryResponse = z.object({
  messages: z.array(GroupHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/method-history",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        fromMessageId: z.coerce.number().int().nonnegative().optional(),
        // Намерение: "group" — чат обсуждения, "dm" — личка канала. Каталог
        // лички шлёт "dm" явно (иначе при выбранной группе ушли бы в группу).
        target: z.enum(["group", "dm"]).optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: GroupHistoryResponse },
        },
        description: "Group history with per-message sender",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { limit, fromMessageId, target } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const { chatId, accountId } = await resolveMethodChat(
      channel,
      wsId,
      userId,
      role,
      target,
    );
    // Tenancy: аккаунт-участник доступен пользователю (404 иначе — нельзя читать
    // чужой чат через чужой аккаунт). Закреплённый аккаунт лички тоже проходит
    // через эту проверку — чужой колеги-аккаунт даст честный 404, не форк треда.
    await assertAccountAccess(accountId, wsId, userId, role);
    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    type TdMsg = {
      id: number;
      date: number;
      is_outgoing: boolean;
      content: TdContent;
      sender_id: { _: string; user_id?: number; chat_id?: number };
      // Подпись анонимного админа группы (td_api.tl §message.author_signature).
      author_signature?: string;
    };

    let opened = false;
    let aggregated: TdMsg[] = [];
    try {
      await client.invoke({ _: "openChat", chat_id: chatId } as never);
      opened = true;
      let from = fromMessageId ?? 0;
      for (let i = 0; i < 5; i++) {
        const r = (await client.invoke({
          _: "getChatHistory",
          chat_id: chatId,
          from_message_id: from,
          offset: 0,
          limit: limit - aggregated.length,
          only_local: false,
        } as never)) as { messages: TdMsg[] };
        if (!r.messages?.length) break;
        aggregated = [...aggregated, ...r.messages];
        if (aggregated.length >= limit) break;
        from = Number(r.messages[r.messages.length - 1]!.id);
      }
    } catch (e) {
      throw new HTTPException(404, {
        message: `group history failed: ${errMsg(e)}`,
      });
    } finally {
      if (opened) {
        await client
          .invoke({ _: "closeChat", chat_id: chatId } as never)
          .catch(() => {});
      }
    }

    // Имена отправителей-юзеров: getUser — offline для юзер-аккаунтов
    // (td_api.tl §getUser), участники уже в TDLib-кэше после openChat. Кэш на
    // запрос: один getUser на уникального отправителя, не на сообщение.
    const nameCache = new Map<number, string>();
    const resolveUserName = async (uid: number): Promise<string> => {
      const cached = nameCache.get(uid);
      if (cached) return cached;
      let name = `Участник ${uid}`;
      try {
        const u = (await client.invoke({
          _: "getUser",
          user_id: uid,
        } as never)) as {
          first_name?: string;
          last_name?: string;
          usernames?: { active_usernames?: string[] };
        };
        const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
        name =
          full ||
          (u.usernames?.active_usernames?.[0]
            ? `@${u.usernames.active_usernames[0]}`
            : name);
      } catch {
        // offline-miss → fallback на «Участник {id}»
      }
      nameCache.set(uid, name);
      return name;
    };

    const messages = [];
    for (const m of aggregated) {
      const { text } = extractFormattedText(m.content);
      // Отправитель: свой → «Вы»; юзер → имя (getUser); анонимный админ
      // (messageSenderChat) → author_signature или общая метка.
      const senderName = m.is_outgoing
        ? "Вы"
        : m.sender_id._ === "messageSenderUser" && m.sender_id.user_id != null
          ? await resolveUserName(m.sender_id.user_id)
          : m.author_signature || "Админ группы";
      messages.push({
        id: String(m.id),
        date: new Date(m.date * 1000).toISOString(),
        text: text || "[медиа]",
        isOutgoing: !!m.is_outgoing,
        senderName,
      });
    }
    return c.json({ messages });
  },
);

const GroupSendBody = z.object({
  text: z.string().min(1).max(4096),
  // Намерение: "group" — чат обсуждения, "dm" — личка канала (см. method-history).
  target: z.enum(["group", "dm"]).optional(),
});

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/method-send",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: GroupSendBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Sent to group" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { text, target } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const { chatId, accountId, dmStarCost } = await resolveMethodChat(
      channel,
      wsId,
      userId,
      role,
      target,
    );
    // Платная личка канала = ручной способ: не списываем звёзды с аккаунта из
    // CRM, менеджер пишет сам в Telegram (spec §16.9). Чтение (history) при этом
    // разрешено.
    if (dmStarCost != null && dmStarCost > 0) {
      throw new HTTPException(400, {
        message: `Личка канала платная (${dmStarCost}⭐) — отправьте вручную в Telegram`,
      });
    }
    // Tenancy: аккаунт-участник доступен пользователю.
    await assertAccountAccess(accountId, wsId, userId, role);
    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }
    try {
      // sendMessage оптимистичен (возвращает Message сразу). Проверяем
      // sending_state на синхронный отказ — платная группа/write-forbidden
      // (td_api.tl: messageSendingStateFailed.required_paid_message_star_count).
      // Async-отказ (slow-mode и т.п.) ловит updateMessageSendFailed-листенер,
      // как и у quick-send — полного подтверждения ручных отправок нет.
      const sent = (await client.invoke({
        _: "sendMessage",
        chat_id: chatId,
        input_message_content: inputMessageText(text),
      } as never)) as {
        sending_state?: {
          _: string;
          error?: { message?: string };
          required_paid_message_star_count?: number;
        };
      };
      if (sent.sending_state?._ === "messageSendingStateFailed") {
        const st = sent.sending_state;
        const paid = st.required_paid_message_star_count;
        throw new HTTPException(400, {
          message: paid
            ? `Группа требует ${paid}⭐ за сообщение — отправьте вручную`
            : `Telegram отклонил отправку: ${st.error?.message ?? "send failed"}`,
        });
      }
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        await setAccountCooldown(accountId, Date.now() + (flood + 5) * 1000, `FloodWait ${flood}s`);
        throw new HTTPException(429, {
          message: `Telegram FloodWait — аккаунт замолчал на ${flood} сек`,
        });
      }
      throw new HTTPException(400, { message: msg });
    }
    return c.body(null, 204);
  },
);

// CSV-строка → типизированное значение кастом-поля по каталогу. null = ячейка
// пустая/нераспознанная (не пишем). Для select'ов CSV даёт человекочитаемое имя
// опции — резолвим по name (case-insensitive), затем по id. multi_select —
// значения через запятую.
// optionIndex — заранее построенный словарь lower(name|id) → id для select-поля
// (см. buildOptionIndex). Передаётся снаружи, чтобы не делать linear .find на
// каждую из десятков тысяч CSV-строк.
function coerceImportPropertyValue(
  def: FieldDef,
  rawInput: string | undefined,
  optionIndex: Map<string, string> | undefined,
): unknown {
  const raw = rawInput?.trim();
  if (!raw) return null;
  const resolveOption = (s: string): string | null =>
    optionIndex?.get(s.trim().toLowerCase()) ?? null;
  switch (def.type) {
    case "single_select":
      return resolveOption(raw);
    case "multi_select": {
      const ids = raw
        .split(",")
        .map((s) => resolveOption(s))
        .filter((x): x is string => x !== null);
      return ids.length > 0 ? Array.from(new Set(ids)) : null;
    }
    case "number": {
      const n = Number(raw.replace(/\s+/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    default:
      // text/textarea/email/tel/url/user_select — строка как есть.
      return raw;
  }
}

// Индекс опций select-поля: lower(name|id) → id. id кладём первым, name — вторым,
// чтобы при коллизии имя имело приоритет (как старый «сначала по name»).
function buildOptionIndex(def: FieldDef): Map<string, string> {
  const idx = new Map<string, string>();
  for (const v of def.values ?? []) idx.set(v.id.toLowerCase(), v.id);
  for (const v of def.values ?? []) idx.set(v.name.toLowerCase(), v.id);
  return idx;
}

// CSV-импорт каналов с column-mapping. Body: {rows, mapping, platform}.
// Юзер на фронте маппит колонки в ImportWizard, бэк применяет.
//
// Правило приоритета: соцсетевой pull всегда побеждает.
//   - synced_at IS NULL → CSV пишет всё (типизированные поля + properties)
//   - synced_at IS NOT NULL → CSV пишет только properties; типизированные
//     поля остаются от соцсети
// admin_username и properties всегда обновляются — соцсеть их не отдаёт.
// Кастом-поля (mapping.properties) валидируются по каталогу канала; ключи не из
// каталога и нераспознанные select-значения молча отбрасываются.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/import",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: ImportChannelsSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ImportChannelsResultSchema } },
        description: "Import result",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const { rows, mapping } = c.req.valid("json");

    // Каталог кастом-полей канала — для коэрции/валидации mapping.properties.
    const propertyDefs = await loadChannelPropertyDefs(wsId);
    const defByKey = new Map(propertyDefs.map((d) => [d.key, d]));
    // Индексы опций select-полей строим один раз (не на каждую строку).
    const optionIndexByKey = new Map<string, Map<string, string>>();
    for (const d of propertyDefs) {
      if (d.type === "single_select" || d.type === "multi_select") {
        optionIndexByKey.set(d.key, buildOptionIndex(d));
      }
    }

    // Step 1: применяем mapping к каждой строке CSV → нормализованный staging.
    // Идентификатор — ОДНА колонка-ссылка. Платформа детектится из домена
    // построчно (тот же резолвер, что и ручная вставка); для TG username/инвайт
    // извлекаются из URL. Одна точка истины — нет рассинхрона username vs link.
    // Ключ дедупа: platform + (lower(username) | lower(link)).
    type Staged = {
      title: string;
      platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
      username: string | null;
      link: string | null;
      memberCount: number | null;
      description: string | null;
      // lower-case без `@`, для smart-stub резолва.
      adminUsername: string | null;
      properties: Record<string, unknown>;
    };
    const stagedByKey = new Map<string, Staged>();
    let skippedNoIdentifier = 0;
    const propsMap = mapping.properties ?? {};

    const pickStr = (r: Record<string, string>, h: string | undefined) =>
      h ? r[h]?.trim() || null : null;
    const stagedKey = (s: Pick<Staged, "platform" | "username" | "link">) =>
      `${s.platform}:` +
      (s.username ? `un:${s.username.toLowerCase()}` : `ln:${s.link!.toLowerCase()}`);

    for (const r of rows) {
      const linkRaw = pickStr(r, mapping.link);
      // Адрес → платформа + идентификатор одним резолвером (общий с bulk).
      const resolved = linkRaw ? resolveChannelIdentifier(linkRaw) : null;
      if (!resolved) {
        skippedNoIdentifier++;
        continue;
      }
      const { platform, username, link } = resolved;
      const key = stagedKey({ platform, username, link });

      const description = pickStr(r, mapping.description);
      const memCntRaw = pickStr(r, mapping.memberCount);
      const memCntParsed = memCntRaw ? Number(memCntRaw.replace(/\s+/g, "")) : NaN;
      const memberCount = Number.isFinite(memCntParsed) ? memCntParsed : null;
      const adminRaw = pickStr(r, mapping.adminUsername);
      const adminUsername = adminRaw
        ? adminRaw.replace(/^@/, "").toLowerCase()
        : null;

      // properties: только ключи из каталога; значение коэрсим под тип поля.
      const properties: Record<string, unknown> = {};
      for (const [pkey, csvHeader] of Object.entries(propsMap)) {
        const def = defByKey.get(pkey);
        if (!def) continue;
        const v = coerceImportPropertyValue(
          def,
          r[csvHeader],
          optionIndexByKey.get(pkey),
        );
        if (v !== null) properties[pkey] = v;
      }

      // title без явного маппинга — fallback на @username или link,
      // чтобы NOT NULL constraint не падал.
      const titleFromCsv = pickStr(r, mapping.title);
      const title = titleFromCsv || (username ? `@${username}` : link!);

      const existing = stagedByKey.get(key);
      if (existing) {
        // Несколько CSV-строк на тот же канал → склеиваем, ранняя строка
        // приоритетнее по непустым полям, properties мержатся.
        stagedByKey.set(key, {
          title: existing.title || title,
          platform: existing.platform,
          username: existing.username || username,
          link: existing.link || link,
          memberCount: existing.memberCount ?? memberCount,
          description: existing.description || description,
          adminUsername: existing.adminUsername || adminUsername,
          properties: { ...existing.properties, ...properties },
        });
      } else {
        stagedByKey.set(key, {
          title,
          platform,
          username,
          link,
          memberCount,
          description,
          adminUsername,
          properties,
        });
      }
    }

    // Step 2: lookup существующих каналов по lower(username) ИЛИ lower(link).
    // Платформа теперь построчная → не фильтруем по ней в SQL, а кладём в ключ
    // мапы (`${platform}:un|ln:value`) и матчим уже с учётом платформы строки.
    // link-ключ берём только у staged без username (иначе дедуп идёт по @).
    const stagedList = [...stagedByKey.values()];
    const usernamesLower = stagedList
      .map((s) => s.username?.toLowerCase())
      .filter((x): x is string => !!x);
    const linksLower = stagedList
      .filter((s) => !s.username && s.link)
      .map((s) => s.link!.toLowerCase());

    const existingChannels =
      usernamesLower.length || linksLower.length
        ? await db
            .select({
              id: channels.id,
              platform: channels.platform,
              usernameLower: sql<string | null>`lower(${channels.username})`,
              linkLower: sql<string | null>`lower(${channels.link})`,
              syncedAt: channels.syncedAt,
              properties: channels.properties,
            })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                or(
                  usernamesLower.length
                    ? inArray(sql`lower(${channels.username})`, usernamesLower)
                    : undefined,
                  linksLower.length
                    ? inArray(sql`lower(${channels.link})`, linksLower)
                    : undefined,
                ),
              ),
            )
        : [];

    // Ключ совпадает со stagedKey: `${platform}:un|ln:value`.
    const existingByKey = new Map<string, (typeof existingChannels)[number]>();
    for (const e of existingChannels) {
      if (e.usernameLower) {
        existingByKey.set(`${e.platform}:un:${e.usernameLower}`, e);
      }
      if (e.linkLower) {
        existingByKey.set(`${e.platform}:ln:${e.linkLower}`, e);
      }
    }

    // Step 3: разруливаем INSERT vs UPDATE-typed vs UPDATE-props-only.
    type ToInsert = Staged & { __ins: true };
    type ToUpdateFull = Staged & {
      __upd: "full";
      id: string;
      mergedProps: Record<string, unknown>;
    };
    type ToUpdatePropsOnly = {
      __upd: "props";
      id: string;
      mergedProps: Record<string, unknown>;
      adminUsername: string | null;
      // Прямая ссылка на staged-row, чтобы потом не искать через
      // O(N²) linear-scan для построения idByKey.
      staged: Staged;
    };
    const toInsert: ToInsert[] = [];
    const toUpdateFull: ToUpdateFull[] = [];
    const toUpdatePropsOnly: ToUpdatePropsOnly[] = [];

    for (const staged of stagedList) {
      const exMatch = existingByKey.get(stagedKey(staged)) ?? null;
      if (!exMatch) {
        toInsert.push({ ...staged, __ins: true });
        continue;
      }
      const merged = {
        ...((exMatch.properties as Record<string, unknown>) ?? {}),
        ...staged.properties,
      };
      if (exMatch.syncedAt) {
        toUpdatePropsOnly.push({
          __upd: "props",
          id: exMatch.id,
          mergedProps: merged,
          adminUsername: staged.adminUsername,
          staged,
        });
      } else {
        toUpdateFull.push({
          ...staged,
          __upd: "full",
          id: exMatch.id,
          mergedProps: merged,
        });
      }
    }

    // Step 4: stub-контакты для admin'ов (та же логика что была в старом
    // /import: smart-stub — если @username есть в tg_users replica, контакт
    // создаётся с tg_user_id сразу).
    const uniqueAdminUsernames = new Set<string>();
    for (const s of stagedList) {
      if (s.adminUsername) uniqueAdminUsernames.add(s.adminUsername);
    }
    let adminContactsCreated = 0;
    let adminContactsRecognized = 0;
    const usernameToContactId = new Map<string, string>();
    if (uniqueAdminUsernames.size > 0) {
      const usernames = [...uniqueAdminUsernames];
      const existingContacts = await db
        .select({
          id: contacts.id,
          username: contactUsernameLowerSql,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(
              contactUsernameLowerSql,
              usernames,
            ),
          ),
        );
      for (const e of existingContacts) {
        if (e.username) usernameToContactId.set(e.username, e.id);
      }
      const missing = usernames.filter((u) => !usernameToContactId.has(u));
      if (missing.length > 0) {
        const known = await db
          .select({
            userId: tgUsers.userId,
            username: sql<string>`lower(${tgUsers.username})`,
            fullName: tgUsers.fullName,
          })
          .from(tgUsers)
          .where(
            and(
              eq(tgUsers.isDeleted, false),
              inArray(sql`lower(${tgUsers.username})`, missing),
            ),
          );
        const knownByUsername = new Map(known.map((k) => [k.username, k]));
        const stubInserts = missing.map((u) => {
          const k = knownByUsername.get(u);
          const props: Record<string, unknown> = {
            telegram_username: u,
            full_name: k?.fullName || `@${u}`,
          };
          if (k?.userId) props.tg_user_id = k.userId;
          if (k) adminContactsRecognized++;
          return { workspaceId: wsId, properties: props, createdBy: userId };
        });
        for (const chunk of chunks(stubInserts, INSERT_CHUNK)) {
          const inserted = await db
            .insert(contacts)
            .values(chunk)
            .onConflictDoNothing()
            .returning({
              id: contacts.id,
              username: contactUsernameLowerSql,
            });
          for (const ins of inserted) {
            if (ins.username) usernameToContactId.set(ins.username, ins.id);
          }
          adminContactsCreated += inserted.length;
        }
        // ON CONFLICT мог проглотить race — дочитываем.
        const stillMissing = missing.filter((u) => !usernameToContactId.has(u));
        if (stillMissing.length > 0) {
          const reread = await db
            .select({
              id: contacts.id,
              username: contactUsernameLowerSql,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, wsId),
                inArray(
                  contactUsernameLowerSql,
                  stillMissing,
                ),
              ),
            );
          for (const r of reread) {
            if (r.username) usernameToContactId.set(r.username, r.id);
          }
        }
      }
    }

    // Step 5: bulk INSERT новых каналов чанками по INSERT_CHUNK.
    let channelsCreated = 0;
    // Свежесозданные id — для жадной MAX-выгрузки на импорте (CHAT_INFO ×100).
    const createdChannelIds: string[] = [];
    const idByKey = new Map<string, string>();
    if (toInsert.length > 0) {
      const allRows = toInsert.map((t) => ({
        workspaceId: wsId,
        platform: t.platform,
        title: t.title,
        description: t.description,
        username: t.username,
        link: t.link,
        memberCount: t.memberCount,
        properties: t.properties,
        createdBy: userId,
      }));
      for (const chunk of chunks(allRows, INSERT_CHUNK)) {
        const inserted = await db
          .insert(channels)
          .values(chunk)
          .returning({
            id: channels.id,
            platform: channels.platform,
            usernameLower: sql<string | null>`lower(${channels.username})`,
            linkLower: sql<string | null>`lower(${channels.link})`,
          });
        for (const ins of inserted) {
          // Ключ как stagedKey: `${platform}:un|ln:value`.
          if (ins.usernameLower) {
            idByKey.set(`${ins.platform}:un:${ins.usernameLower}`, ins.id);
          } else if (ins.linkLower) {
            idByKey.set(`${ins.platform}:ln:${ins.linkLower}`, ins.id);
          }
          if (ins.platform === "max") createdChannelIds.push(ins.id);
        }
        channelsCreated += inserted.length;
      }
    }

    // Также мапим существующих в тот же idByKey — для admin-привязки ниже.
    for (const u of toUpdateFull) {
      idByKey.set(stagedKey(u), u.id);
    }
    for (const u of toUpdatePropsOnly) {
      idByKey.set(stagedKey(u.staged), u.id);
    }

    // Step 6: bulk UPDATE существующих каналов через unnest(). Один SQL на
    // все строки — даже на 14k без N+1. postgres-js принимает массивы и
    // авто-сериализует в text[]/int[]/jsonb-массивы.
    if (toUpdateFull.length > 0) {
      const ids = toUpdateFull.map((u) => u.id);
      const titles = toUpdateFull.map((u) => u.title);
      const usernames = toUpdateFull.map((u) => u.username);
      const links = toUpdateFull.map((u) => u.link);
      const members = toUpdateFull.map((u) => u.memberCount);
      const descs = toUpdateFull.map((u) => u.description);
      const propsJson = toUpdateFull.map((u) => JSON.stringify(u.mergedProps));
      await sqlClient`
        UPDATE channels c SET
          title = u.title,
          username = COALESCE(u.username, c.username),
          link = COALESCE(u.link, c.link),
          member_count = COALESCE(u.member_count, c.member_count),
          description = COALESCE(u.description, c.description),
          properties = u.properties::jsonb,
          updated_at = now()
        FROM unnest(
          ${ids}::text[],
          ${titles}::text[],
          ${usernames}::text[],
          ${links}::text[],
          ${members}::integer[],
          ${descs}::text[],
          ${propsJson}::text[]
        ) AS u(id, title, username, link, member_count, description, properties)
        WHERE c.id = u.id
      `;
    }

    if (toUpdatePropsOnly.length > 0) {
      const ids = toUpdatePropsOnly.map((u) => u.id);
      const propsJson = toUpdatePropsOnly.map((u) =>
        JSON.stringify(u.mergedProps),
      );
      await sqlClient`
        UPDATE channels c SET
          properties = u.properties::jsonb,
          updated_at = now()
        FROM unnest(
          ${ids}::text[],
          ${propsJson}::text[]
        ) AS u(id, properties)
        WHERE c.id = u.id
      `;
    }

    // Step 7: channel_admins. Авто-детект админа из импорта НЕ перебивает
    // активное размещение молча — иначе рождается «зомби»-карточка: канал
    // числится за одним контактом, а карточка ведёт другого (channel_admins и
    // project_items.contact_id расходятся, heal тут не звался). Классифицируем
    // каждую детект-связь по состоянию размещений канала:
    //  • КОНФЛИКТ (есть живое размещение с ДРУГИМ получателем) → channel_admins
    //    не трогаем, кладём кандидата в meta.suggested_admin: оператор увидит на
    //    карточке «админ сменился → перевести?» и решит сам (осознанный set-admin);
    //  • БЕЗОПАСНО (размещения нет / получатель совпадает / сирота) → пишем
    //    channel_admins; для каналов с размещениями лечим сирот (heal без
    //    override — заполняем contact_id IS NULL, не перетирая настроенных).
    const detectedLinks: {
      channelId: string;
      contactId: string;
      username: string;
    }[] = [];
    for (const staged of stagedList) {
      if (!staged.adminUsername) continue;
      const channelId = idByKey.get(stagedKey(staged));
      const contactId = usernameToContactId.get(staged.adminUsername);
      if (channelId && contactId) {
        detectedLinks.push({
          channelId,
          contactId,
          username: staged.adminUsername,
        });
      }
    }
    if (detectedLinks.length > 0) {
      const detChannelIds = [...new Set(detectedLinks.map((l) => l.channelId))];
      const placementRows = await db
        .select({
          channelId: projectItems.channelId,
          contactId: projectItems.contactId,
        })
        .from(projectItems)
        .where(inArray(projectItems.channelId, detChannelIds));
      const recipientsByChannel = new Map<string, Set<string>>();
      const channelsWithPlacement = new Set<string>();
      for (const p of placementRows) {
        if (!p.channelId) continue;
        channelsWithPlacement.add(p.channelId);
        if (p.contactId) {
          const set = recipientsByChannel.get(p.channelId) ?? new Set<string>();
          set.add(p.contactId);
          recipientsByChannel.set(p.channelId, set);
        }
      }
      const safeLinks: { channelId: string; contactId: string }[] = [];
      const healChannelIds = new Set<string>();
      const conflicts: { channelId: string; username: string }[] = [];
      for (const l of detectedLinks) {
        const recips = recipientsByChannel.get(l.channelId);
        if (recips && recips.size > 0 && !recips.has(l.contactId)) {
          conflicts.push({ channelId: l.channelId, username: l.username });
        } else {
          safeLinks.push({ channelId: l.channelId, contactId: l.contactId });
          if (channelsWithPlacement.has(l.channelId)) {
            healChannelIds.add(l.channelId);
          }
        }
      }
      for (const chunk of chunks(safeLinks, INSERT_CHUNK)) {
        await db.insert(channelAdmins).values(chunk).onConflictDoNothing();
      }
      for (const channelId of healChannelIds) {
        await healPlacementRecipients(channelId);
      }
      // Safe-канал больше не в конфликте → гасим возможный старый suggested_admin
      // (иначе маркер «админ сменился» завис бы после того, как расхождение ушло:
      // прошлый импорт мог его выставить, а этот подтвердил совпадение). Только
      // каналы с размещением — suggested_admin в принципе ставится лишь для них.
      if (healChannelIds.size > 0) {
        await db
          .update(channels)
          .set({ meta: sql`${channels.meta} - 'suggested_admin'` })
          .where(inArray(channels.id, [...healChannelIds]));
      }
      if (conflicts.length > 0) {
        // Один bulk-UPDATE через unnest (идиома этого файла, ср. Step 6 выше),
        // а не N round-trip'ов: у каждого конфликта свой username в meta.
        const ids = conflicts.map((c) => c.channelId);
        const usernames = conflicts.map((c) => c.username);
        await sqlClient`
          UPDATE channels c SET
            meta = c.meta || jsonb_build_object('suggested_admin', u.username),
            updated_at = now()
          FROM unnest(${ids}::text[], ${usernames}::text[]) AS u(id, username)
          WHERE c.id = u.id
        `;
      }
    }

    // MAX: жадно выгружаем карточки свежесозданных каналов в фоне — CHAT_INFO
    // батчит до 100 id за раз (другое API, чем ленивый per-channel у YT/TikTok).
    // Не блокируем ответ импорта; reach доберётся ленивым single-синком.
    if (createdChannelIds.length > 0) {
      const role = c.get("workspaceRole");
      void (async () => {
        try {
          const picked = await pickMaxClient(wsId, userId, role);
          if (!picked) return;
          const rows = await db
            .select()
            .from(channels)
            .where(inArray(channels.id, createdChannelIds));
          const res = await syncMaxChannelsBatch(picked.client, rows);
          console.log(
            `[max-import] ${wsId}: выгружено ${res.updated}, не резолвнулось ${res.unresolved}`,
          );
        } catch (e) {
          console.error(`[max-import] batch failed ${wsId}:`, errMsg(e));
        }
      })();
    }

    return c.json({
      channelsCreated,
      channelsUpdated: toUpdateFull.length,
      channelsSyncSkipped: toUpdatePropsOnly.length,
      adminContactsCreated,
      adminContactsRecognized,
      skippedNoIdentifier,
    });
  },
);

// Достраивает Channel объекты массивом admins (с минимальными полями для
// рендера колонки «админ» и «закреплён за») + thumbnail из отдельной
// таблицы (LEFT JOIN, может быть null если соц-pull ещё не делали).
async function joinAdmins(
  rows: (typeof channels.$inferSelect)[],
): Promise<Channel[]> {
  if (rows.length === 0) return [];
  const wsId = rows[0]!.workspaceId;
  const channelIds = rows.map((r) => r.id);
  const [adminRows, thumbRows, rknRows] = await Promise.all([
    db
      .select({
        channelId: channelAdmins.channelId,
        contactId: contacts.id,
        properties: contacts.properties,
        primaryAccountId: contacts.primaryAccountId,
      })
      .from(channelAdmins)
      .innerJoin(contacts, eq(channelAdmins.contactId, contacts.id))
      .where(inArray(channelAdmins.channelId, channelIds)),
    db
      .select({
        channelId: channelThumbnails.channelId,
        b64: channelThumbnails.b64,
      })
      .from(channelThumbnails)
      .where(inArray(channelThumbnails.channelId, channelIds)),
    // РКН-матчинг батчем по индексу rkn_records.match_key (T4.5).
    db
      .select({ id: channels.id, isRkn: channelIsRknSql })
      .from(channels)
      .where(inArray(channels.id, channelIds)),
  ]);
  const thumbByChannel = new Map(thumbRows.map((t) => [t.channelId, t.b64]));
  const rknByChannel = new Map(rknRows.map((r) => [r.id, r.isRkn]));

  // Диалоги команды с админами (tg_chats, воркспейс-wide) → «кружочки» в таблице.
  // Ключ — tg_user_id админа. Один запрос на весь батч каналов.
  const adminTgUserIds = [
    ...new Set(
      adminRows
        .map((a) => {
          const p = a.properties as Record<string, unknown>;
          return typeof p.tg_user_id === "string" ? p.tg_user_id : null;
        })
        .filter((x): x is string => x !== null),
    ),
  ];
  type ChatAccount = {
    accountId: string;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  };
  const chatAccountsByPeer = new Map<string, ChatAccount[]>();
  if (adminTgUserIds.length > 0) {
    const chatRows = await db
      .select({
        peerUserId: tgChats.peerUserId,
        accountId: tgChats.accountId,
        lastInboundAt: tgChats.lastInboundAt,
        lastOutboundAt: tgChats.lastOutboundAt,
      })
      .from(tgChats)
      .innerJoin(outreachAccounts, eq(outreachAccounts.id, tgChats.accountId))
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          inArray(tgChats.peerUserId, adminTgUserIds),
          // «Общались» = админ нам ОТВЕТИЛ хотя бы раз, а не «мы написали» и не
          // «openChat по пустому чату». Сигнал — has_inbound (peer когда-либо
          // слал входящее), тот же, что в resolveWarmTgUserIds (warm-set).
          eq(tgChats.hasInbound, true),
        ),
      );
    for (const r of chatRows) {
      const list = chatAccountsByPeer.get(r.peerUserId) ?? [];
      list.push({
        accountId: r.accountId,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: r.lastOutboundAt?.toISOString() ?? null,
      });
      chatAccountsByPeer.set(r.peerUserId, list);
    }
  }

  const byChannel = new Map<
    string,
    {
      contactId: string;
      fullName: string | null;
      telegramUsername: string | null;
      primaryAccountId: string | null;
      chatAccounts: ChatAccount[];
    }[]
  >();
  for (const a of adminRows) {
    const props = a.properties as Record<string, unknown>;
    const tgUserId =
      typeof props.tg_user_id === "string" ? props.tg_user_id : null;
    const list = byChannel.get(a.channelId) ?? [];
    list.push({
      contactId: a.contactId,
      fullName:
        typeof props.full_name === "string" ? props.full_name : null,
      telegramUsername:
        typeof props.telegram_username === "string"
          ? props.telegram_username
          : null,
      primaryAccountId: a.primaryAccountId,
      chatAccounts: tgUserId ? chatAccountsByPeer.get(tgUserId) ?? [] : [],
    });
    byChannel.set(a.channelId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    platform: r.platform,
    externalId: r.externalId,
    title: r.title,
    description: r.description,
    relationStatus: r.relationStatus,
    relationHistory: r.relationHistory,
    username: r.username,
    link: r.link,
    memberCount: r.memberCount,
    meta: r.meta,
    properties: r.properties,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    unavailableSince: r.unavailableSince?.toISOString() ?? null,
    unavailableLastCheckAt: r.unavailableLastCheckAt?.toISOString() ?? null,
    unavailableReason: r.unavailableReason ?? null,
    thumbnailB64: thumbByChannel.get(r.id) ?? null,
    isRkn: rknByChannel.get(r.id) ?? false,
    admins: byChannel.get(r.id) ?? [],
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

export default app;

import { randomBytes } from "node:crypto";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSENoBuffer } from "../lib/sse.ts";
import {
  and,
  eq,
  getTableColumns,
  ilike,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  CONTACT_FIELD_DEFS,
  type ChannelRelationStatus,
  type ChannelRelationEntry,
  ContactSchema as BaseContactSchema,
  UpdateContactSchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client.ts";
import { buildEntityNote } from "../lib/entity-note.ts";
import {
  contacts,
  conversationShares,
  outreachAccounts,
  properties as propsTable,
  tgChats,
  tgUsers,
} from "../db/schema.ts";
import {
  assertContactAccess,
  contactAccessClause,
} from "../lib/contacts-access.ts";
import { subscribeContacts } from "../lib/events.ts";
import { onMarkedUnread, onReadInbox } from "../lib/outreach-listener.ts";
import { channelRknExistsSqlText } from "../lib/rkn-registry.ts";
import { ilikeContains } from "../lib/ilike.ts";
import type { TdClient } from "../lib/tdlib/index.ts";
import {
  contactTgUserIdSql,
  contactUsernameSql,
} from "../lib/contact-sql.ts";
import {
  enforceRequiredProperties,
  validateEntityProperties,
} from "../lib/entity-properties.ts";
import {
  assertAccountAccess,
  assertAccountInWorkspace,
} from "../lib/outreach-access.ts";
import { ensureContactTgUserId } from "../lib/ensure-tg-user-id.ts";
import { errMsg } from "../lib/errors.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { maxPeerRef, sendMaxMessage } from "../lib/max-account-client.ts";
import { fetchMaxDialog, pickMaxAccount } from "../lib/max-conversation.ts";
import { sendMedia, downloadToBytes } from "../lib/td-files.ts";
import type { OutgoingFile } from "../lib/td-files.ts";
import { resolveStickyByPeerIds } from "../lib/sticky.ts";
import {
  ChatMessageSchema,
  mapMessage,
  type TdMessage,
} from "../lib/chat-message.ts";
import {
  inputMessageText,
  parseInlineEntities,
} from "../lib/td-message.ts";
import { respondWithCreativeMedia } from "../lib/creative-media-response.ts";
import {
  assertRole,
  type WorkspaceRole,
  type WorkspaceVars,
} from "../middleware/assert-member.ts";

// Subquery: ближайший открытый reminder для контакта. Тащим в каждый GET — чтобы
// kanban-карточки могли показывать NextStep без N+1 запросов. Возвращает null,
// если у контакта нет открытых напоминаний с датой. Экспортируется — используется
// также в /leads endpoint'е (карточка лида на канбане проекта).
//
// NB: correlated к `contacts.id` — работает только в SELECT'е, где `contacts`
// есть во FROM или JOIN'ах.
export const nextStepSql = sql<{
  date: string;
  text: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
} | null>`(
  SELECT row_to_json(a) FROM (
    SELECT date, text, repeat
    FROM activities
    WHERE activities.contact_id = contacts.id
      AND activities.type = 'reminder'
      AND activities.status = 'open'
      AND activities.date IS NOT NULL
    ORDER BY date ASC
    LIMIT 1
  ) a
)`.as("next_step");

// Subquery: аккаунты с DM-историей. Колонка «Кто общался» рисуется без
// доп.запросов, табы правой панели сортируются по lastInboundAt.
type ChatAccountRow = {
  accountId: string;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
};
const chatAccountsSql = sql<ChatAccountRow[]>`(
  SELECT COALESCE(json_agg(t ORDER BY t."lastInboundAt" DESC NULLS LAST, t."lastOutboundAt" DESC NULLS LAST), '[]'::json)
  FROM (
    SELECT
      tg_chats.account_id AS "accountId",
      tg_chats.last_inbound_at AS "lastInboundAt",
      tg_chats.last_outbound_at AS "lastOutboundAt"
    FROM tg_chats
    JOIN outreach_accounts ON outreach_accounts.id = tg_chats.account_id
    WHERE outreach_accounts.workspace_id = contacts.workspace_id
      AND tg_chats.peer_user_id = (contacts.properties->>'tg_user_id')
      AND (contacts.properties->>'tg_user_id') IS NOT NULL
  ) t
)`.as("chat_accounts");

// Subquery: каналы, в которых контакт записан админом (m:n channel_admins).
// Минимум для table-row на карточке контакта; полный Channel — отдельным
// GET /channels/{id} из ChannelDrawer.
type ChannelRow = {
  id: string;
  title: string;
  username: string | null;
  memberCount: number | null;
  lastMessageAt: string | null;
  hasDm: boolean;
  unavailableSince: string | null;
  isRkn: boolean;
  relationStatus: ChannelRelationStatus;
  relationHistory: ChannelRelationEntry[];
};
// relationHistory (append-only лог) нужен только сайдбару (detail), а в
// списочной ручке на 1000 контактов раздувает payload без пользы — table-row
// рисует лишь снимок relationStatus. Поэтому в list-варианте отдаём пустой
// массив (shape остаётся валидным), полную историю — только из selectOne.
const buildChannelsSql = (includeHistory: boolean) =>
  sql<ChannelRow[]>`(
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', ch.id,
        'title', ch.title,
        'username', ch.username,
        'memberCount', ch.member_count,
        'lastMessageAt', ch.last_message_at,
        'hasDm', COALESCE((ch.meta->>'has_dm')::boolean, false),
        'unavailableSince', ch.unavailable_since,
        'isRkn', ${sql.raw(channelRknExistsSqlText("ch"))},
        'relationStatus', ch.relation_status,
        'relationHistory', ${includeHistory ? sql`ch.relation_history` : sql`'[]'::jsonb`}
      )
      ORDER BY ch.last_message_at DESC NULLS LAST, ch.title
    ),
    '[]'::json
  )
  FROM channel_admins ca
  JOIN channels ch ON ch.id = ca.channel_id
  WHERE ca.contact_id = contacts.id
)`.as("channels");

const channelsListSql = buildChannelsSql(false);
const channelsSql = buildChannelsSql(true);

const ContactSchema = BaseContactSchema.openapi("Contact");
const UpdateContactSchema = BaseUpdate.openapi("UpdateContact");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({ wsId: z.string().min(1).max(64), id: z.string().min(1).max(64) });

// Поиск через `q` — по имени, telegram и MAX-ссылке. max_link добавлен, чтобы
// вставка max.ru/u-ссылки находила уже привязанный MAX-контакт (показать его по
// имени, а не плодить дубль с сырым URL). Прочие identity (email/phone) не ищем —
// редко заполнены, мусор в результатах.
const SEARCHABLE_KEYS = ["full_name", "telegram_username", "max_link"];

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Зеркало CHANNELS_PAGE_LIMIT в channels.ts. Защита от 4-мегабайтного JSON
// при 10К stub-контактах (CSV-импорт каналов с admin_username создаёт по
// stub'у на админа). При rows.length === PAGE_LIMIT фронт рисует плашку
// «уточните поиск».
const CONTACTS_PAGE_LIMIT = 1000;

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts",
    tags: ["contacts"],
    request: {
      params: WsParam,
      query: z.object({
        q: z.string().optional(),
        // JSON-encoded { [propertyKey]: value } — динамические ключи плохо лезут
        // в openapi typed query. Оборачиваем строкой и парсим.
        filters: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ContactSchema) } },
        description: "Contacts (опционально отфильтрованные)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { q, filters: filtersStr } = c.req.valid("query");

    let filters: Record<string, string> = {};
    if (filtersStr) {
      try {
        const parsed = JSON.parse(filtersStr);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && v !== "") filters[k] = v;
          }
        }
      } catch {
        throw new HTTPException(400, { message: "filters must be valid JSON" });
      }
    }

    const conditions: SQL[] = [contactAccessClause(wsId)];

    if (q && q.trim()) {
      const pat = ilikeContains(q.trim());
      const matchOr = or(
        ...SEARCHABLE_KEYS.map(
          (k) => ilike(sql`${contacts.properties}->>${k}`, pat) as SQL,
        ),
      );
      if (matchOr) conditions.push(matchOr);
    }

    if (Object.keys(filters).length > 0) {
      // Загружаем определения properties, чтобы выбрать оператор:
      // multi_select хранится массивом → containment, остальное → "->" сравнение.
      const defs = await db
        .select({ key: propsTable.key, type: propsTable.type })
        .from(propsTable)
        .where(eq(propsTable.workspaceId, wsId));
      const typeByKey = new Map(defs.map((d) => [d.key, d.type]));
      for (const [key, value] of Object.entries(filters)) {
        if (typeByKey.get(key) === "multi_select") {
          conditions.push(
            sql`${contacts.properties}->${key} @> ${JSON.stringify([value])}::jsonb`,
          );
        } else {
          conditions.push(sql`${contacts.properties}->>${key} = ${value}`);
        }
      }
    }

    const rows = await db
      .select({
      ...getTableColumns(contacts),
      nextStep: nextStepSql,
      chatAccounts: chatAccountsSql,
      channels: channelsListSql,
    })
      .from(contacts)
      .where(and(...conditions))
      .orderBy(contacts.createdAt)
      .limit(CONTACTS_PAGE_LIMIT);
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Contact",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const row = await selectOne(wsId, id);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: UpdateContactSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (body.properties === undefined) {
      // Нечего обновлять — возвращаем текущий контакт без записи.
      const row = await selectOne(wsId, id);
      if (!row) throw new HTTPException(404, { message: "contact not found" });
      return c.json(serialize(row));
    }

    const existing = await assertContactAccess(id, wsId);

    // null / "" / [] в body.properties → удалить ключ; остальное мерджится поверх.
    const merged = { ...existing.properties };
    for (const [k, v] of Object.entries(body.properties)) {
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete merged[k];
      }
    }
    const validated = validateEntityProperties(CONTACT_FIELD_DEFS, body.properties);
    Object.assign(merged, validated);
    enforceRequiredProperties(CONTACT_FIELD_DEFS, merged);

    await db
      .update(contacts)
      .set({ properties: merged, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));
    const row = await selectOne(wsId, id);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

// Ручное переопределение sticky-закрепления контакта за аккаунтом. В отличие от
// авто-логики (listener / backfill пишут только когда NULL), здесь
// перетираем существующее значение — менеджер берёт коммуникацию на себя.
//
// TODO(11.5 RBAC): валидировать, что accountId принадлежит вызывающему
// member'у (или делегирован ему). Сейчас любой member ws может закрепить
// любой контакт за чужим аккаунтом.
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contacts/{id}/sticky",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              accountId: z.string().min(1).max(64),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Sticky updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    await assertContactAccess(id, wsId);
    // Sticky влияет на будущие ОТПРАВКИ с аккаунта (планировщик закрепляет
    // peer'а) — полный доступ (owner/делегация), не только воркспейс.
    await assertAccountAccess(
      accountId,
      wsId,
      c.get("userId"),
      c.get("workspaceRole"),
    );
    await db
      .update(contacts)
      .set({ primaryAccountId: accountId, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));
    const row = await selectOne(wsId, id);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

// --- MAX-переписка контакта (#5): история + отправка через MAX-аккаунт ws'а ---
// Адрес контакта в MAX (max_user_id | max_link) — общий хелпер maxPeerRef.

const MaxDialogMessageSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    time: z.iso.datetime(),
    outgoing: z.boolean(),
  })
  .openapi("MaxDialogMessage");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/{id}/max-history",
    tags: ["contacts"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              peer: z.object({
                name: z.string(),
                avatarUrl: z.string().nullable(),
              }),
              messages: z.array(MaxDialogMessageSchema),
            }),
          },
        },
        description: "MAX dialog history",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const contact = await assertContactAccess(id, wsId);
    const props = (contact.properties ?? {}) as Record<string, unknown>;
    const peer = maxPeerRef(props);
    if (!peer) {
      throw new HTTPException(400, {
        message: "у контакта нет MAX-адреса (max_user_id/max_link)",
      });
    }
    const account = await pickMaxAccount(wsId, userId, role);
    if (!account) {
      throw new HTTPException(412, { message: "нет активного MAX-аккаунта" });
    }
    // Имя/аватар закешированы в момент привязки админа (set-admin резолвит
    // LINK_INFO и пишет full_name/max_avatar_url) — отдаём из properties как есть.
    try {
      const messages = await fetchMaxDialog(account, peer);
      return c.json({
        peer: {
          name: typeof props.full_name === "string" ? props.full_name : "",
          avatarUrl:
            typeof props.max_avatar_url === "string"
              ? props.max_avatar_url
              : null,
        },
        messages,
      });
    } catch (e) {
      // Мёртвая сессия / протухший LINK_INFO — graceful, как у max-send.
      throw new HTTPException(502, {
        message: `MAX: история недоступна — ${errMsg(e)}`,
      });
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/max-send",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ text: z.string().min(1).max(4000) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              status: z.literal("sent"),
              messageId: z.string().nullable(),
            }),
          },
        },
        description: "MAX DM sent",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const { text } = c.req.valid("json");
    const contact = await assertContactAccess(id, wsId);
    const peer = maxPeerRef(contact.properties);
    if (!peer) {
      throw new HTTPException(400, { message: "у контакта нет MAX-адреса" });
    }
    const account = await pickMaxAccount(wsId, userId, role);
    if (!account) {
      throw new HTTPException(412, { message: "нет активного MAX-аккаунта" });
    }
    try {
      const { messageId } = await sendMaxMessage(account, peer, text);
      return c.json({ status: "sent" as const, messageId });
    } catch (e) {
      throw new HTTPException(502, {
        message: `MAX: не отправилось — ${errMsg(e)}`,
      });
    }
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    await assertContactAccess(id, wsId);
    const result = await db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
      .returning({ id: contacts.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "contact not found" });
    }
    return c.body(null, 204);
  },
);

// Памятка об админе («в отпуске», «жёсткий негатив») — отдельной ручкой,
// симметрично каналу (/channels/{id}/note). Текст + автор/дата на бэке.
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contacts/{id}/note",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ note: z.string().max(2000).nullable() }),
          },
        },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Note saved",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { note } = c.req.valid("json");
    const [updated] = await db
      .update(contacts)
      .set({
        note: await buildEntityNote(c.get("userId"), note),
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, id), contactAccessClause(wsId)))
      .returning({ id: contacts.id });
    if (!updated) throw new HTTPException(404, { message: "not found" });
    const row = await selectOne(wsId, id);
    return c.json(serialize(row!));
  },
);

async function selectOne(wsId: string, id: string) {
  const [row] = await db
    .select({
      ...getTableColumns(contacts),
      nextStep: nextStepSql,
      chatAccounts: chatAccountsSql,
      channels: channelsSql,
    })
    .from(contacts)
    .where(and(eq(contacts.id, id), contactAccessClause(wsId)))
    .limit(1);
  return row;
}

type ContactRow = typeof contacts.$inferSelect & {
  nextStep:
    | { date: string; text: string; repeat: "none" | "daily" | "weekly" | "monthly" }
    | null;
  chatAccounts: ChatAccountRow[];
  channels: ChannelRow[];
};

function serialize(row: ContactRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    properties: row.properties,
    note: row.note,
    nextStep: row.nextStep,
    unreadCount: row.unreadCount,
    markedUnread: row.markedUnread,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    primaryAccountId: row.primaryAccountId,
    chatAccounts: row.chatAccounts,
    channels: row.channels,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function readOnTelegram(
  wsId: string,
  accountId: string,
  tgUserId: string,
): Promise<void> {
  const [acc] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, wsId),
      ),
    )
    .limit(1);
  if (!acc) return;

  // tgUserId == chat_id для chatTypePrivate (TDLib convention).
  const [chatRow] = await db
    .select({ lastMessageId: tgChats.lastMessageId })
    .from(tgChats)
    .where(and(eq(tgChats.accountId, acc.id), eq(tgChats.chatId, tgUserId)))
    .limit(1);
  const lastId = chatRow?.lastMessageId;
  if (!lastId) return;

  const client = await getOutreachWorkerClient({
    id: acc.id,
    workspaceId: wsId,
  });
  if (!client) return;

  await client.invoke({
    _: "viewMessages",
    chat_id: Number(tgUserId),
    message_ids: [Number(lastId)],
    source: { _: "messageSourceChatHistory" },
    force_read: true,
  } as never);
}

// Read-only история чата для правой панели на /contacts.
//
// Стратегия only_local: первый запрос для пары (account, chat) идёт с
// `only_local=false` — TDLib делает MTProto-запрос и заполняет локальный
// кэш. Помечаем в module-level Set; последующие запросы (включая
// pagination через `before`) идут с `only_local=true` — мгновенно из
// кэша, без сети. По length=0 определять cache-miss нельзя: TDLib почти
// всегда держит last_message чата в payload, отдаёт его из кэша как 1
// сообщение даже на свежем чате, и второго RPC не происходит.
//
// На первом ответе с only_local=false TDLib часто отдаёт мгновенно то что
// в кэше (last_message) и параллельно качает остаток. Один retry через
// 500ms с only_local=true подбирает накопленное.
//
// На рестарте api Set теряется → один лишний `only_local=false` на первое
// открытие после рестарта; принято.
//
// Side-effect: после успешного getChatHistory обновляем
// `tg_chats.last_inbound_at`/`last_outbound_at` MAX'ом из полученных
// сообщений и пересчитываем sticky для contact'а через
// resolveStickyByPeerIds. Это естественный backfill: юзер открыл drawer →
// мы попутно уточнили sticky без отдельного RPC.
//
// viewMessages здесь НЕ дёргаем — и это осознанное продуктовое решение, не
// баг. Прочитанность в Telegram выставляется ТОЛЬКО когда менеджер отвечает
// (см. readOnTelegram после quick-send). Причина — приватность менеджера: он
// не хочет «палить» собеседнику, что открыл и прочитал диалог, чтобы его не
// дёргали «ну что, ну когда». Поэтому простой просмотр в CRM read-mark не
// ставит. НЕ возвращаться к этому без пересмотра требования.
const historyFetched = new Set<string>();
const historyKey = (accountId: string, chatId: string) =>
  `${accountId}:${chatId}`;

const PeerStatusSchema = z.object({
  isOnline: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat-history",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      query: z.object({
        accountId: z.string().min(1).max(64),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // Cursor для pagination: id самого старого сообщения, которое уже
        // есть на клиенте. Без него — newest 50.
        before: z.string().min(1).max(64).optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              messages: z.array(ChatMessageSchema),
              lastReadOutboxId: z.string().nullable(),
              peerStatus: PeerStatusSchema.nullable(),
              // Контакт — бот (этап 16.9): фронт показывает «Запустить бота»
              // при пустом диалоге и трактует reply_markup как бот-кнопки.
              peerIsBot: z.boolean(),
              // TDLib chat_id диалога (нужен для пометки сообщения в фазе
              // «Запуск» — кладём в тег вместе с messageIds). null если диалога нет.
              chatId: z.string().nullable(),
            }),
          },
        },
        description: "Last N messages, newest first",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId, limit, before } = c.req.valid("query");

    // accountId намеренно НЕ валидируется по доступу (см.
    // specs/permissions.md §3 «Намеренные исключения»).
    const contact = await assertContactAccess(id, wsId);
    const props = contact.properties as Record<string, unknown>;

    await assertAccountInWorkspace(accountId, wsId);

    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    // Lazy-резолв tg_user_id для контактов, импортированных по @ без
    // последующих отправок — один раз через searchPublicChat, сохраняем в
    // properties. Без id ни tg_chats, ни history открыть не можем.
    const tgUserId = await ensureContactTgUserId({
      workspaceId: wsId,
      contactId: id,
      properties: props,
      client,
    });
    if (!tgUserId) {
      throw new HTTPException(400, {
        message: typeof props.telegram_username === "string"
          ? "@username не найден в Telegram"
          : "У контакта нет ни TG ID, ни @username — нечем найти в Telegram",
      });
    }

    // tg_users.is_bot (для peerIsBot) наполняется в ensureContactTgUserId в
    // момент резолва — на первом открытии строка уже есть (без гонки с
    // асинхронным репликатором).
    const [[chatRow], [peerStatusRow]] = await Promise.all([
      db
        .select({
          chatId: tgChats.chatId,
          lastReadOutboxId: tgChats.lastReadOutboxId,
        })
        .from(tgChats)
        .where(
          and(eq(tgChats.accountId, accountId), eq(tgChats.peerUserId, tgUserId)),
        )
        .limit(1),
      db
        .select({
          isOnline: tgUsers.isOnline,
          lastSeenAt: tgUsers.lastSeenAt,
          isBot: tgUsers.isBot,
        })
        .from(tgUsers)
        .where(eq(tgUsers.userId, tgUserId))
        .limit(1),
    ]);
    const peerStatus = peerStatusRow
      ? {
          isOnline: peerStatusRow.isOnline,
          lastSeenAt: peerStatusRow.lastSeenAt?.toISOString() ?? null,
        }
      : null;
    const peerIsBot = peerStatusRow?.isBot ?? false;
    if (!chatRow) {
      return c.json({
        messages: [],
        lastReadOutboxId: null,
        peerStatus,
        peerIsBot,
        chatId: null,
      });
    }

    const fromMessageId = before ? Number(before) : 0;
    const fetchHistory = (only_local: boolean) =>
      client.invoke({
        _: "getChatHistory",
        chat_id: Number(chatRow.chatId),
        from_message_id: fromMessageId,
        offset: 0,
        limit,
        only_local,
      } as never) as Promise<{ messages: TdMessage[] }>;

    const cacheKey = historyKey(accountId, chatRow.chatId);
    const onlyLocal = historyFetched.has(cacheKey);

    // openChat: TG-сервер начинает push'ить апдейты (read-receipts, deletes,
    // typing) по этому чату в реальном времени. Дёргаем один раз на cache
    // miss — повторные вызовы для уже открытого чата идемпотентны, но это
    // лишний RPC через worker.
    if (!onlyLocal) {
      client
        .invoke({ _: "openChat", chat_id: Number(chatRow.chatId) } as never)
        .catch((e: unknown) =>
          console.error(
            `[contacts/chat-history] openChat ${chatRow.chatId}:`,
            errMsg(e),
          ),
        );
    }

    let result = await fetchHistory(onlyLocal);

    // На первом open (cache miss) TDLib часто отдаёт мгновенно last_message
    // из кэша и параллельно качает остаток. Один retry через 500ms
    // подбирает накопленное. По td_api.tl §getChatHistory: «can be smaller
    // than the specified limit» — но pagination и hasMore-логику мы
    // строим только на пустом ответе, не на «меньше limit».
    if (!onlyLocal && !before && result.messages.length < limit) {
      await new Promise((r) => setTimeout(r, 500));
      const second = await fetchHistory(true);
      if (second.messages.length > result.messages.length) result = second;
    }
    // Сетевой добор старого при пагинации. Локальная message-DB включена только
    // с 02.07 (use_message_database, коммит 90681b5) → диалоги ДО этого в ней не
    // персистились, и скролл вверх упирался в пустоту (в мессенджере история
    // есть, у нас — нет). Если локальный ответ на пагинацию пуст — один раз
    // добираем с серверов TG (only_local=false). Только на ПУСТОМ ответе (не
    // флудим на каждый скролл) и только при `before` (первый open и так сетевой).
    // Side-effect getChatHistory(false): TDLib персистит добранное в локал (DB
    // включена) → следующий скролл уже из кэша; и backfillInboundOutbound ниже
    // подлатает tg_chats пропущенными при skipOldUpdates датами.
    if (onlyLocal && before && result.messages.length === 0) {
      const net = await fetchHistory(false);
      if (net.messages.length > 0) result = net;
    }
    if (!onlyLocal) historyFetched.add(cacheKey);

    // Backfill last_inbound_at / last_outbound_at точными датами.
    void backfillInboundOutbound(
      accountId,
      chatRow.chatId,
      tgUserId,
      wsId,
      result.messages,
    ).catch((e) =>
      console.error("[contacts/chat-history] backfill failed:", errMsg(e)),
    );

    return c.json({
      messages: result.messages.map(mapMessage),
      lastReadOutboxId: chatRow.lastReadOutboxId,
      peerStatus,
      peerIsBot,
      chatId: String(chatRow.chatId),
    });
  },
);

// closeChat — обратный сигнал для openChat (см. chat-history endpoint).
// Drawer на размонтировании / смене accountId дёргает этот endpoint, TDLib
// останавливает realtime push'и по чату. Без явного close TDLib держит чат
// «открытым» неопределённо долго, держа лишний background traffic.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat/close",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        description: "Closed",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const contact = await assertContactAccess(id, wsId);
    const tgUserId = (contact.properties as Record<string, unknown>).tg_user_id;
    if (typeof tgUserId !== "string") return c.json({ ok: false });

    const [chatRow] = await db
      .select({ chatId: tgChats.chatId })
      .from(tgChats)
      .where(
        and(eq(tgChats.accountId, accountId), eq(tgChats.peerUserId, tgUserId)),
      )
      .limit(1);
    if (!chatRow) return c.json({ ok: false });

    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) return c.json({ ok: false });
    historyFetched.delete(historyKey(accountId, chatRow.chatId));
    client
      .invoke({ _: "closeChat", chat_id: Number(chatRow.chatId) } as never)
      .catch((e: unknown) =>
        console.error(
          `[contacts/chat/close] closeChat ${chatRow.chatId}:`,
          errMsg(e),
        ),
      );
    return c.json({ ok: true });
  },
);

// Резолв «контакт + аккаунт → TDLib-чат» для chat-ручек (mark-unread,
// delete-messages; следующие кандидаты — edit и реакции). Аккаунт проверяется
// на принадлежность воркспейсу — как в chat-history: иначе можно дёргать
// чужой аккаунт по известному id (и холодный getOutreachWorkerClient привяжет
// его listener к чужому workspace).
async function resolveContactChat(
  wsId: string,
  contactId: string,
  accountId: string,
): Promise<{ chatId: string; client: TdClient }> {
  const contact = await assertContactAccess(contactId, wsId);
  const tgUserId = tgUserIdOf(contact.properties);
  if (!tgUserId) {
    throw new HTTPException(400, { message: "У контакта нет TG ID" });
  }
  // Слабый чек (просмотр-UX: mark-read/unread при чтении чужой переписки —
  // read-исключение §3). Write-потребители (delete/edit-messages) обязаны
  // САМИ звать assertAccountAccess до этого резолвера.
  await assertAccountInWorkspace(accountId, wsId);
  const [chatRow] = await db
    .select({ chatId: tgChats.chatId })
    .from(tgChats)
    .where(
      and(eq(tgChats.accountId, accountId), eq(tgChats.peerUserId, tgUserId)),
    )
    .limit(1);
  if (!chatRow) {
    throw new HTTPException(400, {
      message: "У этого аккаунта ещё нет диалога с контактом",
    });
  }
  const client = await getOutreachWorkerClient({
    id: accountId,
    workspaceId: wsId,
  });
  if (!client) {
    throw new HTTPException(503, { message: "tg client unavailable" });
  }
  return { chatId: chatRow.chatId, client };
}

// Пометка диалога «непрочитано» (chat-level, как в Telegram: флаг чата, не
// сообщения — «отмотать прочитанность до сообщения N» протокол не умеет).
// Дёргаем toggleChatIsMarkedAsUnread — пометка видна и в офиц. клиенте;
// зеркало в contacts пишем сразу тем же onMarkedUnread (не ждём эха апдейта,
// guard <> в нём делает эхо no-op).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-unread",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              accountId: z.string().min(1).max(64),
              value: z.boolean(),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ markedUnread: z.boolean() }),
          },
        },
        description: "Toggled",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId, value } = c.req.valid("json");
    const { chatId, client } = await resolveContactChat(wsId, id, accountId);
    try {
      await client.invoke({
        _: "toggleChatIsMarkedAsUnread",
        chat_id: Number(chatId),
        is_marked_as_unread: value,
      } as never);
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
    await onMarkedUnread(wsId, Number(chatId), value, client);
    return c.json({ markedUnread: value });
  },
);

// «Прочитать всё»: осознанное действие менеджера — в отличие от пассивного
// просмотра (тот read-mark НЕ делает, см. chat-history), здесь шлём viewMessages
// до последнего сообщения (блогер увидит «прочитано») и снимаем ручную пометку.
// Зеркало в contacts (unreadCount=0, markedUnread=false) пишем сразу, не дожидаясь
// эха updateChatReadInbox от TG — throttled-связь может тормозить, а guard <> в
// onReadInbox/onMarkedUnread делает эхо no-op.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-read",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Read",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const { chatId, client } = await resolveContactChat(wsId, id, accountId);
    try {
      await readOnTelegram(wsId, accountId, chatId);
      await client.invoke({
        _: "toggleChatIsMarkedAsUnread",
        chat_id: Number(chatId),
        is_marked_as_unread: false,
      } as never);
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
    await onReadInbox(wsId, Number(chatId), 0, client);
    await onMarkedUnread(wsId, Number(chatId), false, client);
    return c.json({ ok: true });
  },
);

// Удаление сообщений — всегда «у обоих» (deleteMessages revoke=true; в private
// DM Telegram это позволяет). Фронт показывает пункт только на своих
// исходящих; если TDLib удалить не может — отдаём его ошибку как есть.
// Ленту фронт перетянет сам: придёт updateDeleteMessages → SSE contact event.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat/delete-messages",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              accountId: z.string().min(1).max(64),
              messageIds: z.array(z.string().min(1).max(64)).min(1).max(100),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Deleted",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId, messageIds } = c.req.valid("json");
    // Удаление — действие от имени аккаунта: полный доступ (owner/делегация),
    // read-исключение §3 сюда не распространяется.
    await assertAccountAccess(
      accountId,
      wsId,
      c.get("userId"),
      c.get("workspaceRole"),
    );
    const { chatId, client } = await resolveContactChat(wsId, id, accountId);
    try {
      await client.invoke({
        _: "deleteMessages",
        chat_id: Number(chatId),
        message_ids: messageIds.map(Number),
        revoke: true,
      } as never);
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
    return c.json({ ok: true });
  },
);

// Редактирование своего текстового сообщения (editMessageText). По td_api.tl
// гейт — messageProperties.can_be_edited, но per-message RPC ради него не
// делаем: фронт показывает «Изменить» только на своих текстовых, а ошибку
// TDLib (например, старше 48ч) отдаём как есть. Ленту фронт перечитает по
// updateMessageContent → SSE. Кастом-эмодзи исходного сообщения при правке
// заменятся юникодом (их entities в edit не прокидываем, MVP), но инлайн-
// форматирование (**жирный**/__подч__/`моно`) парсим — тулбар работает и здесь.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/chat/edit-message",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              accountId: z.string().min(1).max(64),
              messageId: z.string().min(1).max(64),
              // 4096 — лимит длины текстового сообщения Telegram.
              text: z.string().min(1).max(4096),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Edited",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId, messageId, text } = c.req.valid("json");
    // Правка сообщения — действие от имени аккаунта: полный доступ.
    await assertAccountAccess(
      accountId,
      wsId,
      c.get("userId"),
      c.get("workspaceRole"),
    );
    const { chatId, client } = await resolveContactChat(wsId, id, accountId);
    try {
      const fmt = parseInlineEntities(text);
      await client.invoke({
        _: "editMessageText",
        chat_id: Number(chatId),
        message_id: Number(messageId),
        input_message_content: inputMessageText(fmt.text, fmt.entities),
      } as never);
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
    return c.json({ ok: true });
  },
);

// Старт бота (этап 16.9): если диалога с ботом ещё нет, первое действие —
// /start (sendBotStartMessage). Для приватного бот-чата chat_id == bot_user_id.
// После успеха фронт перетягивает chat-history — бот пришлёт меню/приветствие.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/bot-start",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        description: "Bot started",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const contact = await assertContactAccess(id, wsId);

    // Запуск бота — действие от имени аккаунта: полный доступ.
    await assertAccountAccess(
      accountId,
      wsId,
      c.get("userId"),
      c.get("workspaceRole"),
    );

    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }
    const tgUserId = await ensureContactTgUserId({
      workspaceId: wsId,
      contactId: id,
      properties: contact.properties as Record<string, unknown>,
      client,
    });
    if (!tgUserId) {
      throw new HTTPException(400, { message: "не нашли бота в Telegram" });
    }
    try {
      await client.invoke({
        _: "sendBotStartMessage",
        bot_user_id: Number(tgUserId),
        chat_id: Number(tgUserId),
        parameter: "",
      } as never);
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
    return c.json({ ok: true });
  },
);

async function backfillInboundOutbound(
  accountId: string,
  chatId: string,
  peerUserId: string,
  wsId: string,
  messages: TdMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  let maxInbound = 0;
  let maxOutbound = 0;
  for (const m of messages) {
    if (m.is_outgoing) {
      if (m.date > maxOutbound) maxOutbound = m.date;
    } else if (m.date > maxInbound) maxInbound = m.date;
  }
  if (maxInbound === 0 && maxOutbound === 0) return;

  // postgres-js не выводит timestamptz для Date через bind-параметр в
  // GREATEST() — нужно ISO-строкой и явный ::timestamptz cast (та же
  // штука что в outreach-worker getNewLeadsStatsToday).
  const set: Record<string, unknown> = {};
  if (maxInbound > 0) {
    const atIso = new Date(maxInbound * 1000).toISOString();
    set.lastInboundAt = sql`greatest(${tgChats.lastInboundAt}, ${atIso}::timestamptz)`;
    set.hasInbound = true;
  }
  if (maxOutbound > 0) {
    const atIso = new Date(maxOutbound * 1000).toISOString();
    set.lastOutboundAt = sql`greatest(${tgChats.lastOutboundAt}, ${atIso}::timestamptz)`;
  }
  await db
    .update(tgChats)
    .set(set as never)
    .where(and(eq(tgChats.accountId, accountId), eq(tgChats.chatId, chatId)));

  // Если было хотя бы одно incoming — пересчитываем sticky для этого peer'а.
  // Резолвер посмотрит на свежий last_inbound_at и обновит contact.
  if (maxInbound === 0) return;
  const winners = await resolveStickyByPeerIds(wsId, [peerUserId]);
  const winner = winners.get(peerUserId);
  if (!winner) return;
  // Sticky выставляем только если ранее был null. Перетирать существующее
  // не хотим — sticky закрепляется навсегда после первого определения
  // (меняется только при следующем import-contacts).
  await db
    .update(contacts)
    .set({ primaryAccountId: winner })
    .where(
      and(
        eq(contacts.workspaceId, wsId),
        isNull(contacts.primaryAccountId),
        sql`${contactTgUserIdSql} = ${peerUserId}`,
      ),
    );
}


// SSE-стрим контактных апдейтов. Фронт открывает один EventSource на канбан,
// на каждый event делает qc.setQueryData патч / invalidate. Не openapi —
// EventSource не работает с api-client'ом, JSON-shape — `{contactId,
// unreadCount, lastMessageAt}` (см. lib/events.ts ContactEvent).
// NB: путь намеренно НЕ внутри /contacts/{id}/* — иначе stream-сегмент
// конфликтует с `:id` параметром openapi-роута GET /contacts/{id}
// (Hono матчит первый зарегистрированный, и openapi-роут шире).
//
// RBAC (этап 11.5): broadcast по wsId, member'ы получают события и о
// недоступных им контактах. Для скрытия пришлось бы либо проверять access
// на каждый emit (DB-roundtrip на каждое incoming), либо держать кэш
// «доступные мне contactId» с инвалидацией. На MVP оставляем как есть —
// member увидит ID чужого контакта в DevTools, но GET вернёт 404. Если
// окажется проблемой — отфильтровать в subscribeContacts.
app.get("/v1/workspaces/:wsId/contact-stream", (c) => {
  const wsId = c.get("workspaceId");
  return streamSSENoBuffer(c, async (stream) => {
    let closed = false;
    const unsub = subscribeContacts(wsId, (payload) => {
      if (closed) return;
      stream
        .writeSSE({ event: "contact", data: JSON.stringify(payload) })
        .catch(() => {
          /* клиент отключился между abort и записью */
        });
    });
    stream.onAbort(() => {
      closed = true;
      unsub();
    });

    // Flush заголовков сразу: до первого write Hono streamSSE буферизирует
    // response и клиент висит до heartbeat'а 25с. Один пустой comment-frame
    // ничего не несёт фронту, но открывает канал.
    await stream.writeSSE({ event: "ready", data: "" });

    // Heartbeat против idle-timeout прокси. Та же схема что в qr-token-cache.ts.
    const aborted = Promise.withResolvers<void>();
    stream.onAbort(aborted.resolve);
    while (!stream.aborted && !closed) {
      await Promise.race([stream.sleep(25_000), aborted.promise]);
      if (stream.aborted || closed) break;
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        break;
      }
    }
  });
});

// tg_user_id контакта из properties (хранится строкой). null если нет/не строка.
function tgUserIdOf(properties: unknown): string | null {
  const v = (properties as Record<string, unknown> | null | undefined)
    ?.tg_user_id;
  return typeof v === "string" ? v : null;
}

// Резолв «аккаунт+контакт → клиент+tgUserId» для multipart-роутов (accountId
// приходит из body, а getOutreachWorkerClient кэширует по account.id и сам по ws
// НЕ скоупит — проверяем принадлежность воркспейсу здесь).
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Агрегатный потолок батча: байты всех файлов держатся в памяти разом
// (arrayBuffer + копия + запись на диск) — без этого 10×20 МБ × N параллельных
// запросов могут уронить API-процесс.
const MAX_BATCH_BYTES = 50 * 1024 * 1024;
async function resolveChatTarget(
  wsId: string,
  contactId: string,
  accountId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; tgUserId: string }> {
  // Единственный потребитель — send-media (отправка от имени аккаунта):
  // полный доступ, не только принадлежность воркспейсу.
  await assertAccountAccess(accountId, wsId, userId, role);
  const [contact] = await db
    .select({ properties: contacts.properties })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, wsId)))
    .limit(1);
  const tgUserId = tgUserIdOf(contact?.properties);
  if (!tgUserId) {
    throw new HTTPException(400, {
      message: "У контакта нет TG ID — откройте чат, чтобы резолвить",
    });
  }
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
  return { client, tgUserId };
}

// Отправка файлов в чат (скрепка/drag-drop композера и drag-drop договора в
// placement-drawer). Plain-роут (не OpenAPI) — проще для multipart; auth берётся
// из wsApp.use(assertMember). Тег не ставим — менеджер пометит сообщение из чата
// после доставки. asFile=true → всё документом без пережатия; иначе картинки
// уходят сжатыми фото, прочее — документом (sendMedia сам группирует в альбомы).
// caption (подпись) — общий, на первый месседж.
app.post("/v1/workspaces/:wsId/contacts/:id/send-media", async (c) => {
  const wsId = c.get("workspaceId");
  const contactId = c.req.param("id");
  const body = await c.req.parseBody({ all: true });
  const accountId = body["accountId"];
  const rawCaption = typeof body["caption"] === "string" ? body["caption"] : "";
  const asFile = body["asFile"] === "true";
  // Ответ на сообщение (reply) — опц.; в sendMedia вешается на первый месседж.
  const replyToRaw = body["replyToMessageId"];
  const replyToMessageId =
    typeof replyToRaw === "string" && replyToRaw ? Number(replyToRaw) : undefined;
  if (typeof accountId !== "string") {
    throw new HTTPException(400, { message: "accountId required" });
  }
  // parseBody({all}) отдаёт массив при нескольких одноимённых полях, иначе одно
  // значение — нормализуем к массиву File.
  const raw = body["file"];
  const files = (Array.isArray(raw) ? raw : [raw]).filter(
    (f): f is File => f instanceof File,
  );
  if (files.length === 0) throw new HTTPException(400, { message: "file required" });
  if (files.length > 10) {
    throw new HTTPException(400, { message: "Не больше 10 файлов за раз" });
  }
  if (files.some((f) => f.size > MAX_UPLOAD_BYTES)) {
    throw new HTTPException(413, { message: "Файл больше 20 МБ" });
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_BATCH_BYTES) {
    throw new HTTPException(413, { message: "Суммарно файлы больше 50 МБ" });
  }
  const { client, tgUserId } = await resolveChatTarget(
    wsId,
    contactId,
    accountId,
    c.get("userId"),
    c.get("workspaceRole"),
  );
  const outgoing: OutgoingFile[] = await Promise.all(
    files.map(async (f) => ({
      bytes: new Uint8Array(await f.arrayBuffer()),
      name: f.name,
      mime: f.type,
    })),
  );
  // Подпись парсим как и текст сообщения: **жирный**/__подч__/`моно` → entities.
  const caption = parseInlineEntities(rawCaption);
  await sendMedia(
    client,
    Number(tgUserId),
    outgoing,
    asFile,
    caption,
    replyToMessageId,
  );
  return c.body(null, 204);
});

// Скачивание файла-документа из чата. Plain-роут (бинарь). fileId/name/mime берём
// из истории (фронт уже их получил), байты тянем on-demand с TDLib, не храним.
app.get("/v1/workspaces/:wsId/contacts/:id/chat-file", async (c) => {
  const wsId = c.get("workspaceId");
  const accountId = c.req.query("accountId");
  const fileId = Number(c.req.query("fileId"));
  const name = c.req.query("name") || "file";
  const mime = c.req.query("mime") || "application/octet-stream";
  if (typeof accountId !== "string" || !Number.isFinite(fileId)) {
    throw new HTTPException(400, { message: "accountId & fileId required" });
  }
  // Read-исключение §3: скачивание файла — часть просмотра переписки.
  await assertAccountInWorkspace(accountId, wsId);
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
  const bytes = await downloadToBytes(client, fileId);
  if (!bytes) throw new HTTPException(404, { message: "file unavailable" });
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Час, не сутки: после пересоздания TDLib-базы (re-login аккаунта)
      // fileId раздаются заново с малых чисел — тот же URL может указать на
      // другой файл. Часа хватает, чтобы не перекачивать превью стикеров при
      // каждом открытии пикера/чата, а окно «чужих байтов» после re-auth мало.
      "Cache-Control": "private, max-age=3600",
    },
  });
});

// Байты фото/видео-постера сообщения личного чата (full-res) — плейн-роут
// (бинарь). Тот же путь, что лента канала (post-media): on-demand, не храним.
// chatId приватного чата == tg_user_id контакта (TDLib convention).
app.get("/v1/workspaces/:wsId/contacts/:id/chat-media/:messageId", async (c) => {
  const wsId = c.get("workspaceId");
  const contactId = c.req.param("id");
  const messageId = c.req.param("messageId");
  const accountId = c.req.query("accountId");
  if (typeof accountId !== "string") {
    throw new HTTPException(400, { message: "accountId required" });
  }
  // Read-исключение §3: медиа — часть просмотра переписки.
  await assertAccountInWorkspace(accountId, wsId);
  const [contact] = await db
    .select({ properties: contacts.properties })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, wsId)))
    .limit(1);
  const tgUserId = tgUserIdOf(contact?.properties);
  if (!tgUserId) {
    throw new HTTPException(404, { message: "no tg id" });
  }
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
  return respondWithCreativeMedia(
    client,
    { chatId: tgUserId, messageId, albumId: null },
    0,
  );
});

// ── Публичная read-only ссылка на переписку ─────────────────────────────────
// Создание/отзыв magic-link'а на диалог (contact, account). Публичное чтение —
// в conversation-share-client.ts (по токену, без сессии). Ссылку копируют в
// карточку внешней CRM; смотрит любой по ссылке в read-only.

const ConversationShareSchema = z
  .object({
    token: z.string(),
    // Относительный путь — фронт добавляет origin.
    url: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ConversationShare");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/share",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ConversationShareSchema } },
        description: "Активная ссылка на переписку (создана или существующая)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    await assertContactAccess(id, wsId);
    // Публикация переписки наружу (magic-link) — действие от имени аккаунта:
    // полный доступ (owner/делегация), не только принадлежность воркспейсу.
    await assertAccountAccess(accountId, wsId, userId, c.get("workspaceRole"));

    // Идемпотентность: одна активная ссылка на (contact, account).
    const [existing] = await db
      .select()
      .from(conversationShares)
      .where(
        and(
          eq(conversationShares.contactId, id),
          eq(conversationShares.accountId, accountId),
          isNull(conversationShares.revokedAt),
        ),
      )
      .limit(1);
    if (existing) return c.json(serializeConversationShare(existing));

    const token = randomBytes(32).toString("base64url");
    const [row] = await db
      .insert(conversationShares)
      .values({
        workspaceId: wsId,
        contactId: id,
        accountId,
        token,
        createdBy: userId,
      })
      .returning();
    return c.json(serializeConversationShare(row!));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/share/revoke",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        description: "Ссылка отозвана (или её не было)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    await assertContactAccess(id, wsId);
    await db
      .update(conversationShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(conversationShares.contactId, id),
          eq(conversationShares.accountId, accountId),
          isNull(conversationShares.revokedAt),
        ),
      );
    return c.json({ ok: true });
  },
);

function serializeConversationShare(
  row: typeof conversationShares.$inferSelect,
) {
  return {
    token: row.token,
    url: `/share/conv/${row.token}`,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

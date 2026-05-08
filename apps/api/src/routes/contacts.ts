import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
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
  ContactSchema as BaseContactSchema,
  UpdateContactSchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  properties as propsTable,
  tgChats,
} from "../db/schema.ts";
import {
  assertContactAccess,
  contactAccessClause,
} from "../lib/contacts-access.ts";
import { emitContactChanged, subscribeContacts } from "../lib/contact-events.ts";
import {
  enforceRequiredProperties,
  loadPropertyDefs,
  validateContactProperties,
} from "../lib/contact-properties.ts";
import { errMsg } from "../lib/errors.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { resolveStickyByPeerIds } from "../lib/sticky.ts";
import {
  type TdContent,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
  extractFormattedText,
  extractMediaThumb,
} from "../lib/td-message.ts";
import type { WorkspaceVars } from "../middleware/assert-member.ts";

// Subquery: ближайший открытый reminder для контакта. Тащим в каждый GET — чтобы
// kanban-карточки могли показывать NextStep без N+1 запросов. Возвращает null,
// если у контакта нет открытых напоминаний с датой.
const nextStepSql = sql<{
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
type ChannelRow = { id: string; title: string };
const channelsSql = sql<ChannelRow[]>`(
  SELECT COALESCE(json_agg(json_build_object('id', ch.id, 'title', ch.title) ORDER BY ch.title), '[]'::json)
  FROM channel_admins ca
  JOIN channels ch ON ch.id = ca.channel_id
  WHERE ca.contact_id = contacts.id
)`.as("channels");

const ContactSchema = BaseContactSchema.openapi("Contact");
const UpdateContactSchema = BaseUpdate.openapi("UpdateContact");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({ wsId: z.string().min(1).max(64), id: z.string().min(1).max(64) });

// Поиск через `q` — только по имени и telegram. У нас TG-CRM, остальные identity
// поля (email/phone/url) опциональны и редко заполнены — мусор в результатах.
const SEARCHABLE_KEYS = ["full_name", "telegram_username"];

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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
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

    const conditions: SQL[] = [contactAccessClause(wsId, userId, role)];

    if (q && q.trim()) {
      const pat = `%${q.trim()}%`;
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
      channels: channelsSql,
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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const row = await selectOne(wsId, id, userId, role);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

// Lookup контакта по TG-identifier'у — для chat-iframe sidebar'а: iframe
// шлёт chatOpened с peerId/username, нам надо найти соответствующий контакт.
// Возвращает 404 если не найден; фронт показывает кнопку «Создать лид».
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/lookup/by-tg",
    tags: ["contacts"],
    request: {
      params: WsParam,
      query: z.object({
        tgUserId: z.string().optional(),
        username: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Contact",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { tgUserId, username } = c.req.valid("query");
    if (!tgUserId && !username) {
      throw new HTTPException(400, {
        message: "either tgUserId or username required",
      });
    }
    const conds: SQL[] = [];
    if (tgUserId) {
      conds.push(sql`${contacts.properties}->>'tg_user_id' = ${tgUserId}`);
    }
    if (username) {
      const u = username.replace(/^@/, "");
      conds.push(sql`${contacts.properties}->>'telegram_username' = ${u}`);
    }
    // nextStep здесь не нужен — sidebar чата рендерит компактную карточку
    // без активити. Не тащим correlated subquery.
    const [row] = await db
      .select(getTableColumns(contacts))
      .from(contacts)
      .where(and(contactAccessClause(wsId, userId, role), or(...conds)))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(
      serialize({
        ...row,
        nextStep: null,
        chatAccounts: [],
        channels: [],
      }),
    );
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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    if (body.properties === undefined) {
      // Нечего обновлять — возвращаем текущий контакт без записи.
      const row = await selectOne(wsId, id, userId, role);
      if (!row) throw new HTTPException(404, { message: "contact not found" });
      return c.json(serialize(row));
    }

    const existing = await assertContactAccess(id, wsId, userId, role);

    // null / "" / [] в body.properties → удалить ключ; остальное мерджится поверх.
    const merged = { ...existing.properties };
    for (const [k, v] of Object.entries(body.properties)) {
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete merged[k];
      }
    }
    const defs = await loadPropertyDefs(wsId);
    const validated = validateContactProperties(defs, body.properties);
    Object.assign(merged, validated);
    enforceRequiredProperties(defs, merged);

    await db
      .update(contacts)
      .set({ properties: merged, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));
    const row = await selectOne(wsId, id, userId, role);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    await assertContactAccess(id, wsId, userId, role);
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

async function selectOne(
  wsId: string,
  id: string,
  userId: string,
  role: "admin" | "member",
) {
  const [row] = await db
    .select({
      ...getTableColumns(contacts),
      nextStep: nextStepSql,
      chatAccounts: chatAccountsSql,
      channels: channelsSql,
    })
    .from(contacts)
    .where(and(eq(contacts.id, id), contactAccessClause(wsId, userId, role)))
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
    nextStep: row.nextStep,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    primaryAccountId: row.primaryAccountId,
    chatAccounts: row.chatAccounts,
    channels: row.channels,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// Mark-read: (а) локально UPDATE unread=0 + emit SSE, (б) синхронизируем с TG
// через messages.ReadHistory от имени переданного outreach-аккаунта.
//
// Локальный UPDATE обязателен: TG НЕ присылает UpdateReadHistoryInbox обратно
// тому клиенту, который сам инициировал readHistory (только на ОСТАЛЬНЫЕ
// устройства юзера). То есть наш listener эту операцию не услышит, и без
// локального UPDATE счётчик в БД останется грязным до следующей синхронизации.
//
// Вызов TG — fire-and-forget после ответа (на телефоне в TG чат тоже отметится
// прочитанным). Если упадёт — счётчик в CRM уже сброшен, на телефоне останется
// как было. Логируем но не валим запрос.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/read",
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
    responses: { 204: { description: "Marked as read" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");

    // Проверка контакт-доступа: чужой контакт мы не должны помечать прочитанным
    // (он у коллеги в badge'ах висит). 404 если не виден этому юзеру.
    await assertContactAccess(id, wsId, userId, role);

    // 1) Локальный UPDATE + emit. Главное действие — пользователь увидит сброс
    //    badge'а немедленно, остальные вкладки канбана через SSE.
    const result = await db
      .update(contacts)
      .set({ unreadCount: 0 })
      .where(
        and(
          eq(contacts.id, id),
          eq(contacts.workspaceId, wsId),
          sql`${contacts.unreadCount} > 0`,
        ),
      )
      .returning({
        id: contacts.id,
        properties: contacts.properties,
        lastMessageAt: contacts.lastMessageAt,
      });

    if (result.length > 0) {
      const row = result[0]!;
      emitContactChanged(wsId, {
        contactId: row.id,
        unreadCount: 0,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      });

      // 2) Синхронизация с TG — fire-and-forget. Не ждём ответ TG чтобы фронт
      //    не висел на сетевом round-trip MTProto.
      const tgUserId = (row.properties as Record<string, unknown>).tg_user_id;
      if (typeof tgUserId === "string") {
        void readOnTelegram(wsId, accountId, tgUserId).catch((e) => {
          console.error(
            `[contacts/read] TG sync failed (contact=${id}):`,
            errMsg(e),
          );
        });
      }
    }
    return c.body(null, 204);
  },
);

async function readOnTelegram(
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
// viewMessages здесь НЕ дёргаем — иначе случайно отметим непрочитанные ИХ
// сообщения как прочитанные при простом просмотре.
const historyFetched = new Set<string>();
const historyKey = (accountId: string, chatId: string) =>
  `${accountId}:${chatId}`;

const ChatMessageSchema = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  isOutgoing: z.boolean(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
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
            schema: z.object({ messages: z.array(ChatMessageSchema) }),
          },
        },
        description: "Last N messages, newest first",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { id } = c.req.valid("param");
    const { accountId, limit, before } = c.req.valid("query");

    // accountId намеренно НЕ валидируется по доступу (см.
    // specs/permissions.md §3 «Намеренные исключения»).
    const contact = await assertContactAccess(id, wsId, userId, role);
    const tgUserId = (contact.properties as Record<string, unknown>).tg_user_id;
    if (typeof tgUserId !== "string") {
      throw new HTTPException(400, { message: "contact has no telegram id" });
    }

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
    if (!acc) throw new HTTPException(404, { message: "account not found" });

    const [chatRow] = await db
      .select({ chatId: tgChats.chatId })
      .from(tgChats)
      .where(and(eq(tgChats.accountId, acc.id), eq(tgChats.peerUserId, tgUserId)))
      .limit(1);
    if (!chatRow) {
      return c.json({ messages: [] });
    }

    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
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

    const cacheKey = historyKey(acc.id, chatRow.chatId);
    const onlyLocal = historyFetched.has(cacheKey);
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
    if (!onlyLocal) historyFetched.add(cacheKey);

    // Backfill last_inbound_at / last_outbound_at точными датами.
    void backfillInboundOutbound(
      acc.id,
      chatRow.chatId,
      tgUserId,
      wsId,
      result.messages,
    ).catch((e) =>
      console.error("[contacts/chat-history] backfill failed:", errMsg(e)),
    );

    return c.json({ messages: result.messages.map(mapMessage) });
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
        sql`${contacts.properties}->>'tg_user_id' = ${peerUserId}`,
      ),
    );
}

type TdMessage = {
  id: number | string;
  date: number;
  is_outgoing: boolean;
  content: TdContent;
};

function mapMessage(m: TdMessage): z.infer<typeof ChatMessageSchema> {
  const { text, entities } = extractFormattedText(m.content);
  const mediaThumb = extractMediaThumb(m.content);
  return {
    id: String(m.id),
    date: new Date(m.date * 1000).toISOString(),
    isOutgoing: m.is_outgoing,
    // Sticker/voice/audio/location/poll/… — без текста и без thumb;
    // короткий type-label, чтобы пузырь не был пустым.
    text: text || (mediaThumb ? "" : fallbackLabel(m.content._)),
    entities,
    mediaThumb,
  };
}

function fallbackLabel(contentType: string): string {
  switch (contentType) {
    case "messageVoiceNote":
      return "[голосовое]";
    case "messageVideoNote":
      return "[видеосообщение]";
    case "messageSticker":
      return "[стикер]";
    case "messageAudio":
      return "[аудио]";
    case "messageDocument":
      return "[файл]";
    case "messageLocation":
      return "[геопозиция]";
    case "messageContact":
      return "[контакт]";
    case "messagePoll":
      return "[опрос]";
    default:
      return `[${contentType.replace(/^message/, "")}]`;
  }
}

// SSE-стрим контактных апдейтов. Фронт открывает один EventSource на канбан,
// на каждый event делает qc.setQueryData патч / invalidate. Не openapi —
// EventSource не работает с api-client'ом, JSON-shape — `{contactId,
// unreadCount, lastMessageAt}` (см. lib/contact-events.ts ContactEvent).
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
  return streamSSE(c, async (stream) => {
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

export default app;

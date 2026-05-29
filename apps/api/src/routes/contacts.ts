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
  tgUsers,
} from "../db/schema.ts";
import {
  assertContactAccess,
  contactAccessClause,
} from "../lib/contacts-access.ts";
import { subscribeContacts } from "../lib/events.ts";
import {
  contactTgUserIdSql,
  contactUsernameSql,
} from "../lib/contact-sql.ts";
import {
  enforceRequiredProperties,
  loadPropertyDefs,
  validateContactProperties,
} from "../lib/contact-properties.ts";
import { ensureContactTgUserId } from "../lib/ensure-tg-user-id.ts";
import { errMsg } from "../lib/errors.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { sendDocument, downloadToBytes } from "../lib/td-files.ts";
import { resolveStickyByPeerIds } from "../lib/sticky.ts";
import {
  type TdContent,
  TdDocumentSchema,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
  extractDocument,
  extractFormattedText,
  extractMediaThumb,
} from "../lib/td-message.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

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
};
const channelsSql = sql<ChannelRow[]>`(
  SELECT COALESCE(
    json_agg(
      json_build_object(
        'id', ch.id,
        'title', ch.title,
        'username', ch.username,
        'memberCount', ch.member_count,
        'lastMessageAt', ch.last_message_at,
        'hasDm', COALESCE((ch.meta->>'has_dm')::boolean, false),
        'unavailableSince', ch.unavailable_since
      )
      ORDER BY ch.last_message_at DESC NULLS LAST, ch.title
    ),
    '[]'::json
  )
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
    const { id } = c.req.valid("param");
    const row = await selectOne(wsId, id);
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
    const { tgUserId, username } = c.req.valid("query");
    if (!tgUserId && !username) {
      throw new HTTPException(400, {
        message: "either tgUserId or username required",
      });
    }
    const conds: SQL[] = [];
    if (tgUserId) {
      conds.push(sql`${contactTgUserIdSql} = ${tgUserId}`);
    }
    if (username) {
      const u = username.replace(/^@/, "");
      conds.push(sql`${contactUsernameSql} = ${u}`);
    }
    // nextStep здесь не нужен — sidebar чата рендерит компактную карточку
    // без активити. Не тащим correlated subquery.
    const [row] = await db
      .select(getTableColumns(contacts))
      .from(contacts)
      .where(and(contactAccessClause(wsId), or(...conds)))
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
    const defs = await loadPropertyDefs(wsId);
    const validated = validateContactProperties(defs, body.properties);
    Object.assign(merged, validated);
    enforceRequiredProperties(defs, merged);

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
    await db
      .update(contacts)
      .set({ primaryAccountId: accountId, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));
    const row = await selectOne(wsId, id);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
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
// viewMessages здесь НЕ дёргаем — иначе случайно отметим непрочитанные ИХ
// сообщения как прочитанные при простом просмотре.
const historyFetched = new Set<string>();
const historyKey = (accountId: string, chatId: string) =>
  `${accountId}:${chatId}`;

// Кнопки бота (этап 16.9). Нормализуем TDLib reply_markup в плоскую модель,
// которую фронт рендерит без знания TDLib-типов:
//   - url        → ссылка (inlineKeyboardButtonTypeUrl);
//   - send_text  → нажатие отправляет text кнопки (replyMarkupShowKeyboard);
//   - unsupported→ показываем серой, нажать нельзя (callback/webapp/оплата/…
//     не делаем в MVP, см. AskUserQuestion «Только reply-клавиатура»).
const ReplyButtonSchema = z.object({
  text: z.string(),
  action: z.enum(["url", "send_text", "unsupported"]),
  url: z.string().optional(),
});
const ReplyMarkupSchema = z.object({
  kind: z.enum(["inline", "keyboard"]),
  rows: z.array(z.array(ReplyButtonSchema)),
});

const ChatMessageSchema = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  isOutgoing: z.boolean(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
  document: TdDocumentSchema.nullable(),
  replyMarkup: ReplyMarkupSchema.nullable(),
  // id альбома (media_album_id), если сообщение — часть альбома; иначе null.
  // Фронт группирует по нему при пометке сообщения (фаза «Запуск»).
  albumId: z.string().nullable(),
});

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

    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
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

    const [[chatRow], [peerStatusRow]] = await Promise.all([
      db
        .select({
          chatId: tgChats.chatId,
          lastReadOutboxId: tgChats.lastReadOutboxId,
        })
        .from(tgChats)
        .where(
          and(eq(tgChats.accountId, acc.id), eq(tgChats.peerUserId, tgUserId)),
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

    const cacheKey = historyKey(acc.id, chatRow.chatId);
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

    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
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

type TdInlineButton = {
  text: string;
  type: { _: string; url?: string };
};
type TdKeyboardButton = { text: string; type: { _: string } };
type TdReplyMarkup = {
  _: string;
  rows?: (TdInlineButton[] | TdKeyboardButton[])[];
};
type TdMessage = {
  id: number | string;
  date: number;
  is_outgoing: boolean;
  content: TdContent;
  reply_markup?: TdReplyMarkup;
  media_album_id?: number | string;
};

// TDLib reply_markup → нормализованная модель (см. ReplyMarkupSchema).
function mapReplyMarkup(
  rm: TdReplyMarkup | undefined,
): z.infer<typeof ReplyMarkupSchema> | null {
  if (!rm) return null;
  if (rm._ === "replyMarkupInlineKeyboard") {
    const rows = (rm.rows ?? []).map((row) =>
      (row as TdInlineButton[]).map((b) =>
        b.type._ === "inlineKeyboardButtonTypeUrl" && b.type.url
          ? { text: b.text, action: "url" as const, url: b.type.url }
          : { text: b.text, action: "unsupported" as const },
      ),
    );
    return { kind: "inline", rows };
  }
  if (rm._ === "replyMarkupShowKeyboard") {
    const rows = (rm.rows ?? []).map((row) =>
      (row as TdKeyboardButton[]).map((b) =>
        // Обычная текст-кнопка → нажатие шлёт её текст. Спец-кнопки (запрос
        // контакта/локации/webapp) — серым, в MVP не обрабатываем.
        b.type._ === "keyboardButtonTypeText"
          ? { text: b.text, action: "send_text" as const }
          : { text: b.text, action: "unsupported" as const },
      ),
    );
    return { kind: "keyboard", rows };
  }
  // replyMarkupRemoveKeyboard / replyMarkupForceReply — рендерить нечего.
  return null;
}

function mapMessage(m: TdMessage): z.infer<typeof ChatMessageSchema> {
  const { text, entities } = extractFormattedText(m.content);
  const mediaThumb = extractMediaThumb(m.content);
  const document = extractDocument(m.content);
  return {
    id: String(m.id),
    date: new Date(m.date * 1000).toISOString(),
    isOutgoing: m.is_outgoing,
    // Sticker/voice/audio/location/poll/… — без текста и без thumb;
    // короткий type-label, чтобы пузырь не был пустым. Документ рендерится
    // отдельным пузырём → fallback-label не нужен.
    text: text || (mediaThumb || document ? "" : fallbackLabel(m.content._)),
    entities,
    mediaThumb,
    document,
    replyMarkup: mapReplyMarkup(m.reply_markup),
    albumId:
      m.media_album_id && String(m.media_album_id) !== "0"
        ? String(m.media_album_id)
        : null,
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

// Отправка файла документом в чат (drag-drop). Plain-роут (не OpenAPI) — proще
// для multipart; auth берётся из wsApp.use(assertMember). Тег не ставим — менеджер
// пометит сообщение из чата после доставки.
app.post("/v1/workspaces/:wsId/contacts/:id/send-document", async (c) => {
  const wsId = c.get("workspaceId");
  const contactId = c.req.param("id");
  const body = await c.req.parseBody();
  const file = body["file"];
  const accountId = body["accountId"];
  const caption = typeof body["caption"] === "string" ? body["caption"] : "";
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "file required" });
  }
  if (typeof accountId !== "string") {
    throw new HTTPException(400, { message: "accountId required" });
  }
  if (file.size > 20 * 1024 * 1024) {
    throw new HTTPException(413, { message: "Файл больше 20 МБ" });
  }
  // accountId приходит из body — проверяем принадлежность воркспейсу
  // (getOutreachWorkerClient кэширует по account.id и сам по ws не скоупит).
  const [acc] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(eq(outreachAccounts.id, accountId), eq(outreachAccounts.workspaceId, wsId)),
    )
    .limit(1);
  if (!acc) throw new HTTPException(404, { message: "account not found" });
  const [contact] = await db
    .select({ properties: contacts.properties })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, wsId)))
    .limit(1);
  const tgUserId = (contact?.properties as Record<string, unknown> | undefined)
    ?.tg_user_id;
  if (typeof tgUserId !== "string") {
    throw new HTTPException(400, {
      message: "У контакта нет TG ID — откройте чат, чтобы резолвить",
    });
  }
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  await sendDocument(client, Number(tgUserId), bytes, file.name, caption);
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
  // accountId из query → проверяем принадлежность воркспейсу (как в send-document).
  const [acc] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(eq(outreachAccounts.id, accountId), eq(outreachAccounts.workspaceId, wsId)),
    )
    .limit(1);
  if (!acc) throw new HTTPException(404, { message: "account not found" });
  const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
  if (!client) throw new HTTPException(503, { message: "tg client unavailable" });
  const bytes = await downloadToBytes(client, fileId);
  if (!bytes) throw new HTTPException(404, { message: "file unavailable" });
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, max-age=300",
    },
  });
});

export default app;

// Контакты: CRUD + core (список/карточка/patch/sticky/MAX-переписка/удаление/
// заметка). TG-чат-секция — в ./chat.ts, публичные ссылки — в ./share.ts;
// монтируются в конце файла в исходном порядке регистрации.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import {
  and,
  eq,
  getTableColumns,
  ilike,
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
import { db } from "../../db/client.ts";
import { buildEntityNote } from "../../lib/entity-note.ts";
import { contacts, properties as propsTable } from "../../db/schema.ts";
import {
  assertContactAccess,
  contactAccessClause,
} from "../../lib/contacts-access.ts";
import { channelRknExistsSqlText } from "../../lib/rkn-registry.ts";
import { ilikeContains } from "../../lib/ilike.ts";
import {
  enforceRequiredProperties,
  validateEntityProperties,
} from "../../lib/entity-properties.ts";
import { assertAccountAccess } from "../../lib/outreach-access.ts";
import { errMsg } from "../../lib/errors.ts";
import { maxPeerRef, sendMaxMessage } from "../../lib/max-account-client.ts";
import { fetchMaxDialog, pickMaxAccount } from "../../lib/max-conversation.ts";
import {
  assertRole,
  type WorkspaceVars,
} from "../../middleware/assert-member.ts";
import { WsIdParam } from "./shared.ts";
import chatApp from "./chat.ts";
import shareApp from "./share.ts";

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

// Секции монтируются после core-роутов — порядок регистрации 1:1 с исходным
// монолитом (core → chat → share).
app.route("/", chatApp);
app.route("/", shareApp);

export default app;

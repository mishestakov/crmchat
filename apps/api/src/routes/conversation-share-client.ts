import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { contacts, conversationShares, tgChats } from "../db/schema.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { ChatMessageSchema, mapMessage } from "../lib/chat-message.ts";
import { type SessionVars } from "../middleware/require-session.ts";

// Публичный read-only доступ к переписке по magic-link (без сессии). Доступ =
// знание токена. Смонтирован ДО protectedApp (см. app.ts), auth — внутри через
// resolveConversationShare.
//
// История тянется LIVE из TDLib, но СТРОГО only_local=true: публичный эндпоинт
// НИКОГДА не инициирует MTProto — сколько по утёкшей ссылке ни долби, нагрузку
// на Telegram/аккаунт это не создаёт (не заабьюзят, не словим флуд-бан).
// Актуальность обеспечивает обычная работа аккаунта (worker/менеджер держат
// чат тёплым), а не внешний зритель. Требует use_message_database=true, иначе
// после рестарта локальный кэш пуст (см. client.ts).

type TdMessage = Parameters<typeof mapMessage>[0];

const TokenParam = z.object({ token: z.string().min(1).max(128) });

const ConversationMessagesSchema = z
  .object({
    // С кем переписка — для шапки публичной страницы.
    title: z.string(),
    // Аккаунт мёртв/разлогинен, диалога нет или контакт без tg_user_id —
    // фронт показывает «переписка временно недоступна», не пустоту-как-конец.
    unavailable: z.boolean(),
    messages: z.array(ChatMessageSchema),
  })
  .openapi("ConversationMessages");

const app = new OpenAPIHono<{ Variables: SessionVars }>();

// Резолв токена → (contact, account). 401 если отозван/нет. Обновляет last_seen.
async function resolveConversationShare(token: string) {
  const [share] = await db
    .select({
      workspaceId: conversationShares.workspaceId,
      contactId: conversationShares.contactId,
      accountId: conversationShares.accountId,
    })
    .from(conversationShares)
    .where(
      and(
        eq(conversationShares.token, token),
        isNull(conversationShares.revokedAt),
      ),
    )
    .limit(1);
  if (!share) {
    throw new HTTPException(401, { message: "Ссылка недействительна" });
  }
  return share;
}

// Fire-and-forget last_seen. .catch обязателен: без него транзиентная ошибка
// БД = unhandled rejection, а Node 24 (--unhandled-rejections=throw) уронит
// процесс от анонимного трафика. Бампим ТОЛЬКО на начальный просмотр (без
// before) — не на каждую подгрузку «более ранних», иначе write на каждый скролл.
function bumpLastSeen(token: string) {
  void db
    .update(conversationShares)
    .set({ lastSeenAt: new Date() })
    .where(eq(conversationShares.token, token))
    .catch(() => {});
}

function contactTitle(props: Record<string, unknown>): string {
  const name = props.full_name;
  if (typeof name === "string" && name.trim()) return name;
  const username = props.telegram_username;
  if (typeof username === "string" && username) return `@${username}`;
  return "Переписка";
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/conv/{token}/messages",
    tags: ["share"],
    request: {
      params: TokenParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        // Cursor: id самого старого сообщения на клиенте (скролл вверх). Пусто —
        // newest. Пустой ответ = достигли начала истории.
        before: z.string().min(1).max(64).optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: ConversationMessagesSchema },
        },
        description: "Read-only история переписки, newest first",
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const { limit, before } = c.req.valid("query");
    const share = await resolveConversationShare(token);
    if (!before) bumpLastSeen(token);

    const [contact] = await db
      .select({ properties: contacts.properties })
      .from(contacts)
      .where(eq(contacts.id, share.contactId))
      .limit(1);
    const props = (contact?.properties ?? {}) as Record<string, unknown>;
    const title = contactTitle(props);

    const tgUserId = props.tg_user_id;
    const unavailable = { title, unavailable: true, messages: [] };
    // Контакт без TG ID — переписки в TDLib нет (MAX/stub-контакт).
    if (typeof tgUserId !== "string") return c.json(unavailable);

    const [chatRow] = await db
      .select({ chatId: tgChats.chatId })
      .from(tgChats)
      .where(
        and(
          eq(tgChats.accountId, share.accountId),
          eq(tgChats.peerUserId, tgUserId),
        ),
      )
      .limit(1);
    if (!chatRow) return c.json(unavailable);

    const client = await getOutreachWorkerClient({
      id: share.accountId,
      workspaceId: share.workspaceId,
    });
    if (!client) return c.json(unavailable);

    // only_local=true: без сети. openChat НЕ дёргаем — это инициировал бы
    // сетевой трафик от анонимного зрителя (ровно то, чего избегаем).
    // invoke может реджектнуться, если аккаунт разлогинен/сессия закрывается
    // (getOutreachWorkerClient возвращает клиент, не дожидаясь ready) — тогда
    // graceful unavailable, а не 500/«ссылка недействительна» у зрителя.
    let result: { messages: TdMessage[] };
    try {
      result = (await client.invoke({
        _: "getChatHistory",
        chat_id: Number(chatRow.chatId),
        from_message_id: before ? Number(before) : 0,
        offset: 0,
        limit,
        only_local: true,
      } as never)) as { messages: TdMessage[] };
    } catch {
      return c.json(unavailable);
    }

    return c.json({
      title,
      unavailable: false,
      messages: result.messages.map(mapMessage),
    });
  },
);

export default app;

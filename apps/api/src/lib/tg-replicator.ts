import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { tgChats, tgUsers } from "../db/schema";
import type { TdClient } from "./tdlib";

// TG-репликация (этап 9.2). Слушаем client.on('update') и пишем локальную
// копию chat list / user directory в Postgres. Read-сценарии (sticky, импорт,
// аналитика) переезжают на SELECT в этапе 9.3.
//
// Поток:
//   updateNewChat  → full upsert в tg_chats
//   updateUser     → full upsert в tg_users (с hash-skip)
//   updateChatTitle/LastMessage/NewMessage/ReadInbox → partial UPDATE
//
// Буферизация: TDLib на ready пушит 500–2000 update'ов «знакомлю с чатами».
// Накапливаем в Map'ы, flush раз в FLUSH_MS батчем.

const FLUSH_MS = 500;
const BOOTSTRAP_PAGE = 500;

type ChatRow = typeof tgChats.$inferInsert;
type UserRow = typeof tgUsers.$inferInsert;

// Глобальный (cross-account) hash-skip для tg_users. Один и тот же блогер
// у пяти наших аккаунтов даст пять идентичных updateUser при boot-storm —
// без скипа это пять одинаковых INSERT-OR-UPDATE с пустой работой. Map не
// очищается: 45 аккаунтов × ~500 общих юзеров × ~50 байт ≈ 1 МБ — допустимо.
// Сменился username/имя — sha1 расходится, запись прорывается.
const userPayloadHash = new Map<string, string>();

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

type Update = { _: string; [k: string]: unknown };

// TDLib chat (td_api.tl): id, type:ChatType, title, last_message?, unread_count.
type ChatPayload = {
  id: number | string;
  type: { _: string; user_id?: number };
  title: string;
  last_message?: { id: number | string; date: number };
  unread_count?: number;
};

// TDLib user (td_api.tl:2175). usernames может отсутствовать (0-юзеров TG старой
// версии нет, но defensively allow optional).
type UserPayload = {
  id: number | string;
  first_name: string;
  last_name: string;
  phone_number: string;
  usernames?: { active_usernames: string[]; editable_username: string };
  type: { _: string };
};

export type ReplicatorHandle = { detach: () => void };

export function attachReplicator(
  accountId: string,
  client: TdClient,
): ReplicatorHandle {
  // chatBuf — full rows (из updateNewChat). partialChat — патчи поверх существующей
  // строки в БД (updateChatTitle и пр.). Если в одном flush-окне пришли оба —
  // partial мержится в full и partialChat очищается.
  const chatBuf = new Map<string, ChatRow>();
  const partialChat = new Map<string, Partial<ChatRow>>();
  const userBuf = new Map<string, UserRow>();
  // botPeers — user_id'ы ботов. DM с ботами не реплицируем в tg_chats.
  // TDLib гарантирует updateUser до updateNewChat для того же user_id —
  // к моменту handleChat бот уже здесь. Set не персистится, но это ок:
  // на рестарте TDLib пере-пушит updateUser → пере-наполнит set до
  // обработки соответствующих updateNewChat.
  const botPeers = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch((e) =>
        console.error(`[tg-replicator ${accountId}] flush failed:`, e),
      );
    }, FLUSH_MS);
  }

  async function flush(): Promise<void> {
    if (chatBuf.size > 0) {
      const rows = [...chatBuf.values()];
      chatBuf.clear();
      await db
        .insert(tgChats)
        .values(rows)
        .onConflictDoUpdate({
          target: [tgChats.accountId, tgChats.chatId],
          set: {
            peerUserId: sql`excluded.peer_user_id`,
            title: sql`excluded.title`,
            lastMessageId: sql`excluded.last_message_id`,
            lastMessageAt: sql`excluded.last_message_at`,
            unreadCount: sql`excluded.unread_count`,
            raw: sql`excluded.raw`,
            updatedAt: sql`now()`,
          },
        });
    }
    if (userBuf.size > 0) {
      const rows = [...userBuf.values()];
      userBuf.clear();
      await db
        .insert(tgUsers)
        .values(rows)
        .onConflictDoUpdate({
          target: tgUsers.userId,
          set: {
            username: sql`excluded.username`,
            fullName: sql`excluded.full_name`,
            phone: sql`excluded.phone`,
            isDeleted: sql`excluded.is_deleted`,
            raw: sql`excluded.raw`,
            updatedAt: sql`now()`,
          },
        });
    }
    if (partialChat.size > 0) {
      const patches = [...partialChat.entries()];
      partialChat.clear();
      // UPDATE без INSERT: если строки ещё нет — no-op (0 rows affected),
      // полный row придёт позже через updateNewChat. На объёмах MVP per-row
      // UPDATE в транзакции — приемлемо (десятки в секунду).
      await db.transaction(async (tx) => {
        const now = new Date();
        for (const [chatId, patch] of patches) {
          await tx
            .update(tgChats)
            .set({ ...patch, updatedAt: now })
            .where(
              and(eq(tgChats.accountId, accountId), eq(tgChats.chatId, chatId)),
            );
        }
      });
    }
  }

  function handleChat(chat: ChatPayload): void {
    const row = mapChat(accountId, chat);
    if (!row) return;
    // DM с ботом — не реплицируем (одно правило с tg_users: только
    // реальные собеседники).
    if (botPeers.has(row.peerUserId)) return;
    chatBuf.set(row.chatId, row);
    // Если был накоплен partial — full row его перекрывает.
    partialChat.delete(row.chatId);
  }

  function mergeChatPartial(chatId: string, patch: Partial<ChatRow>): void {
    if (chatBuf.has(chatId)) {
      Object.assign(chatBuf.get(chatId)!, patch);
      return;
    }
    const prev = partialChat.get(chatId) ?? {};
    partialChat.set(chatId, { ...prev, ...patch });
  }

  function handleUser(user: UserPayload): void {
    const userId = String(user.id);
    if (user.type._ === "userTypeBot") {
      botPeers.add(userId);
      return;
    }
    botPeers.delete(userId);
    const row = mapUser(user);
    if (!row) return;
    const payloadStr = JSON.stringify(user);
    const hash = sha1(payloadStr);
    if (userPayloadHash.get(userId) === hash) return;
    userPayloadHash.set(userId, hash);
    userBuf.set(userId, row);
  }

  function onUpdate(u: Update): void {
    switch (u._) {
      case "updateNewChat":
        handleChat((u as unknown as { chat: ChatPayload }).chat);
        break;
      case "updateUser":
        handleUser((u as unknown as { user: UserPayload }).user);
        break;
      case "updateChatTitle": {
        const x = u as unknown as { chat_id: number | string; title: string };
        mergeChatPartial(String(x.chat_id), { title: x.title || null });
        break;
      }
      case "updateChatLastMessage": {
        const x = u as unknown as {
          chat_id: number | string;
          last_message?: { id: number | string; date: number };
        };
        if (x.last_message) {
          mergeChatPartial(String(x.chat_id), {
            lastMessageId: String(x.last_message.id),
            lastMessageAt: new Date(x.last_message.date * 1000),
          });
        }
        break;
      }
      case "updateNewMessage": {
        const m = (
          u as unknown as {
            message: {
              chat_id: number | string;
              id: number | string;
              date: number;
            };
          }
        ).message;
        mergeChatPartial(String(m.chat_id), {
          lastMessageId: String(m.id),
          lastMessageAt: new Date(m.date * 1000),
        });
        break;
      }
      case "updateChatReadInbox": {
        const x = u as unknown as {
          chat_id: number | string;
          unread_count: number;
        };
        mergeChatPartial(String(x.chat_id), { unreadCount: x.unread_count });
        break;
      }
      default:
        return;
    }
    scheduleFlush();
  }

  client.on("update", onUpdate);

  // Bootstrap: TDLib на старте показывает только верхушку chat list'а (~50).
  // loadChats догружает остальные диалоги, пушая updateNewChat для каждого.
  // Цикл до error code 404 — TDLib возвращает «Not Found» когда грузить нечего.
  void bootstrap(client).catch((e) =>
    console.error(`[tg-replicator ${accountId}] bootstrap failed:`, e),
  );

  return {
    detach: () => {
      client.off("update", onUpdate);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // Финальный flush в фоне — клиент уже мог быть закрыт, но db-запись
      // не зависит от него.
      void flush().catch((e) =>
        console.error(`[tg-replicator ${accountId}] final flush:`, e),
      );
    },
  };
}

async function bootstrap(client: TdClient): Promise<void> {
  while (true) {
    try {
      await client.invoke({
        _: "loadChats",
        chat_list: { _: "chatListMain" },
        limit: BOOTSTRAP_PAGE,
      } as never);
    } catch (e) {
      const err = e as { code?: number; message?: string };
      if (err?.code === 404) return;
      throw e;
    }
  }
}

function mapChat(accountId: string, chat: ChatPayload): ChatRow | null {
  // Реплицируем только private DM. Группы/каналы/секретные — out of scope CRM.
  if (chat.type._ !== "chatTypePrivate" || chat.type.user_id == null) {
    return null;
  }
  return {
    accountId,
    chatId: String(chat.id),
    peerUserId: String(chat.type.user_id),
    title: chat.title || null,
    lastMessageId: chat.last_message ? String(chat.last_message.id) : null,
    lastMessageAt: chat.last_message
      ? new Date(chat.last_message.date * 1000)
      : null,
    unreadCount: chat.unread_count ?? 0,
    raw: chat as unknown as Record<string, unknown>,
  };
}

function mapUser(user: UserPayload): UserRow | null {
  // Bot фильтруется снаружи (handleUser → botPeers), сюда уже не доходит.
  // Regular — живой собеседник; Deleted/Unknown — мёртвый, помечаем флагом
  // (см. tg_users.is_deleted в schema.ts), чтобы lookup'ы могли отсеивать
  // без повторного searchPublicChat.
  const isDeleted =
    user.type._ === "userTypeDeleted" || user.type._ === "userTypeUnknown";
  if (!isDeleted && user.type._ !== "userTypeRegular") return null;
  const username =
    user.usernames?.active_usernames[0] ||
    user.usernames?.editable_username ||
    null;
  const fullName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || null;
  return {
    userId: String(user.id),
    username,
    fullName,
    phone: user.phone_number || null,
    isDeleted,
    raw: user as unknown as Record<string, unknown>,
  };
}

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { channels, tgChats, tgUsers } from "../db/schema.ts";
import type { TdClient } from "./tdlib/index.ts";
import { extractActiveUsername, extractFullName } from "./tdlib/td-user.ts";

// TG-репликация (этап 9.2). Слушаем client.on('update') и пишем локальную
// копию chat list / user directory в Postgres. Read-сценарии (sticky, импорт,
// аналитика) переезжают на SELECT в этапе 9.3.
//
// Поток:
//   updateNewChat  → full upsert в tg_chats
//   updateUser     → full upsert в tg_users (с hash-skip)
//   updateChatTitle/LastMessage/NewMessage/ReadInbox → partial UPDATE
//   updateSupergroup → JSONB-merge nice-to-have полей в channels.meta
//                      (boost_level, verification, has_dm, … — приходят как
//                      побочный эффект searchPublicChat в sync/history flow,
//                      см. routes/channels.ts)
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

// TDLib chat (td_api.tl): id, type:ChatType, title, last_message?:message,
// unread_count. last_message — полный Message объект, у него есть is_outgoing.
// last_read_inbox_message_id — id последнего прочитанного входящего; > 0 значит
// peer когда-то нам писал. Точную дату из chat payload TDLib не даёт, поэтому
// держим только bool-сигнал has_inbound.
type ChatPayload = {
  id: number | string;
  // chatTypeSupergroup несёт is_channel (true=broadcast-канал, false=группа);
  // chatTypeBasicGroup — всегда группа; chatTypePrivate — DM.
  type: { _: string; user_id?: number; is_channel?: boolean };
  title: string;
  last_message?: { id: number | string; date: number; is_outgoing: boolean };
  unread_count?: number;
  last_read_inbox_message_id?: number | string;
  last_read_outbox_message_id?: number | string;
};

// TDLib user (td_api.tl:2175). usernames может отсутствовать (0-юзеров TG старой
// версии нет, но defensively allow optional).
type UserPayload = {
  id: number | string;
  first_name: string;
  last_name: string;
  usernames?: { active_usernames: string[]; editable_username: string };
  type: { _: string };
  // Presence на момент initial chat list / refresh. Дальше — через
  // updateUserStatus. Empty значит «неизвестно», offline даёт was_online unix.
  status?: { _: string; expires?: number; was_online?: number };
};

type UserStatus = { _: string; expires?: number; was_online?: number };

// Mapping TDLib UserStatus → (isOnline, lastSeenAt). userStatusEmpty не пишем
// (возвращаем null); recently/lastWeek/lastMonth → offline без точной даты.
function mapUserStatus(status: UserStatus | undefined): {
  isOnline: boolean;
  lastSeenAt: Date | null;
} | null {
  if (!status) return null;
  switch (status._) {
    case "userStatusOnline":
      return { isOnline: true, lastSeenAt: null };
    case "userStatusOffline":
      return {
        isOnline: false,
        lastSeenAt: status.was_online
          ? new Date(status.was_online * 1000)
          : null,
      };
    case "userStatusRecently":
    case "userStatusLastWeek":
    case "userStatusLastMonth":
      return { isOnline: false, lastSeenAt: null };
    default:
      return null;
  }
}

// TDLib supergroup (td_api.tl:2489). Только нужные нам поля.
type SupergroupPayload = {
  id: number | string;
  date: number;
  member_count: number;
  boost_level: number;
  has_linked_chat: boolean;
  has_direct_messages_group: boolean;
  is_channel: boolean;
  is_broadcast_group: boolean;
  verification_status?: { is_verified: boolean };
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
  // Presence-апдейты приходят чаще full updateUser (peer переключается онлайн
  // ↔ оффлайн без других изменений). Отдельный buf — flush через UPDATE без
  // INSERT (если строки нет — no-op, full row придёт с updateUser).
  const userStatusBuf = new Map<
    string,
    { isOnline: boolean; lastSeenAt: Date | null }
  >();
  // Буфер meta-патчей по supergroup_id (string). На flush — серия UPDATE'ов
  // channels SET meta = meta || patch WHERE meta->>'supergroup_id' = sgId.
  // Если канала с таким sgId в БД нет (любой канал из подписок юзера) —
  // UPDATE 0 rows, дёшево.
  const channelMetaBuf = new Map<string, Record<string, unknown>>();
  // Группы НЕ реплицируем (этап 16.9 ревизия): пикер привязки читает их live
  // через TDLib (searchChats+getChat, offline), чат группы тоже идёт live.
  // Группы в нашей БД не оседают — приватнее и нет рассинхрона.
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
            lastMessageId: sql`excluded.last_message_id`,
            lastMessageAt: sql`excluded.last_message_at`,
            // GREATEST: повторный updateNewChat от TDLib приносит только
            // одно last_message — оно может перетереть свежее значение
            // противоположного направления, накопленное updateNewMessage'ами.
            lastInboundAt: sql`greatest(${tgChats.lastInboundAt}, excluded.last_inbound_at)`,
            lastOutboundAt: sql`greatest(${tgChats.lastOutboundAt}, excluded.last_outbound_at)`,
            // OR-merge: has_inbound никогда не сбрасывается. Раз увидели
            // признак — храним, для sticky-fallback'а это история не
            // последнего сообщения, а «вообще когда-либо».
            hasInbound: sql`${tgChats.hasInbound} OR excluded.has_inbound`,
            // GREATEST: id сообщений монотонно растут, повторный
            // updateNewChat не должен откатить уже накопленный
            // updateChatReadOutbox.
            lastReadOutboxId: sql`greatest(${tgChats.lastReadOutboxId}::bigint, excluded.last_read_outbox_id::bigint)::text`,
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
            isDeleted: sql`excluded.is_deleted`,
            isBot: sql`excluded.is_bot`,
            isOnline: sql`excluded.is_online`,
            // GREATEST — see flush() для userStatusBuf, не откатываем
            // last_seen_at если новый payload без статуса.
            lastSeenAt: sql`greatest(${tgUsers.lastSeenAt}, excluded.last_seen_at)`,
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
    if (userStatusBuf.size > 0) {
      const patches = [...userStatusBuf.entries()];
      userStatusBuf.clear();
      await db.transaction(async (tx) => {
        const now = new Date();
        for (const [userId, p] of patches) {
          await tx
            .update(tgUsers)
            .set({
              isOnline: p.isOnline,
              // GREATEST через ISO-cast: not-null wins; если приходит null —
              // не перетираем существующее значение (online → offline без
              // was_online сохраняет старую дату как «последний раз видели»).
              ...(p.lastSeenAt
                ? {
                    lastSeenAt: sql`greatest(${tgUsers.lastSeenAt}, ${p.lastSeenAt.toISOString()}::timestamptz)`,
                  }
                : {}),
              updatedAt: now,
            })
            .where(eq(tgUsers.userId, userId));
        }
      });
    }
    if (channelMetaBuf.size > 0) {
      const patches = [...channelMetaBuf.entries()];
      channelMetaBuf.clear();
      await db.transaction(async (tx) => {
        const now = new Date();
        for (const [sgId, patch] of patches) {
          await tx
            .update(channels)
            .set({
              meta: sql`${channels.meta} || ${JSON.stringify(patch)}::jsonb`,
              updatedAt: now,
            })
            .where(sql`${channels.meta}->>'supergroup_id' = ${sgId}`);
        }
      });
    }
  }

  function handleChat(chat: ChatPayload): void {
    // Реплицируем только приватные DM (tg_chats). Группы и broadcast-каналы —
    // мимо: группы читаются live через TDLib (см. /account-groups), каналы
    // живут в channels. mapChat вернёт null для не-private.
    const row = mapChat(accountId, chat);
    if (!row) return;
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
      case "updateChatLastMessage": {
        const x = u as unknown as {
          chat_id: number | string;
          last_message?: {
            id: number | string;
            date: number;
            is_outgoing: boolean;
          };
        };
        if (x.last_message) {
          const at = new Date(x.last_message.date * 1000);
          mergeChatPartial(String(x.chat_id), {
            lastMessageId: String(x.last_message.id),
            lastMessageAt: at,
            ...(x.last_message.is_outgoing
              ? { lastOutboundAt: at }
              : { lastInboundAt: at }),
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
              is_outgoing: boolean;
            };
          }
        ).message;
        const at = new Date(m.date * 1000);
        mergeChatPartial(String(m.chat_id), {
          lastMessageId: String(m.id),
          lastMessageAt: at,
          ...(m.is_outgoing
            ? { lastOutboundAt: at }
            : { lastInboundAt: at, hasInbound: true }),
        });
        break;
      }
      case "updateChatReadOutbox": {
        const x = u as unknown as {
          chat_id: number | string;
          last_read_outbox_message_id: number | string;
        };
        mergeChatPartial(String(x.chat_id), {
          lastReadOutboxId: String(x.last_read_outbox_message_id),
        });
        break;
      }
      case "updateUserStatus": {
        const x = u as unknown as { user_id: number | string; status: UserStatus };
        const mapped = mapUserStatus(x.status);
        if (!mapped) break;
        // Dedup внутри текущего окна flush'а: peer может слать «online» N раз
        // подряд (TG обновляет expires); пишем только если изменилось.
        const userId = String(x.user_id);
        const prev = userStatusBuf.get(userId);
        if (
          prev
          && prev.isOnline === mapped.isOnline
          && prev.lastSeenAt?.getTime() === mapped.lastSeenAt?.getTime()
        ) {
          break;
        }
        userStatusBuf.set(userId, mapped);
        break;
      }
      case "updateSupergroup": {
        const sg = (u as unknown as { supergroup: SupergroupPayload }).supergroup;
        const sgId = String(sg.id);
        const prev = channelMetaBuf.get(sgId) ?? {};
        channelMetaBuf.set(sgId, { ...prev, ...mapSupergroupMeta(sg) });
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
  const lastAt = chat.last_message
    ? new Date(chat.last_message.date * 1000)
    : null;
  const isOut = chat.last_message?.is_outgoing ?? false;
  // has_inbound — слабый сигнал «peer когда-либо отвечал». TRUE если:
  //  - последнее сообщение incoming, ИЛИ
  //  - last_read_inbox_message_id > 0 (был хотя бы один прочитанный входящий), ИЛИ
  //  - unread_count > 0 (есть непрочитанные = тоже входящие).
  // Дату при этом TDLib в chat payload не даёт — для точного last_inbound_at
  // нужен либо updateNewMessage в этой сессии, либо backfill через
  // chat-history endpoint при открытии drawer'а.
  const lastReadInboxId = chat.last_read_inbox_message_id;
  const hasReadInbox =
    lastReadInboxId !== undefined &&
    lastReadInboxId !== null &&
    String(lastReadInboxId) !== "0";
  const hasInbound =
    (lastAt && !isOut) ||
    hasReadInbox ||
    (chat.unread_count ?? 0) > 0;
  const outboxRaw = chat.last_read_outbox_message_id;
  return {
    accountId,
    chatId: String(chat.id),
    peerUserId: String(chat.type.user_id),
    lastMessageId: chat.last_message ? String(chat.last_message.id) : null,
    lastMessageAt: lastAt,
    lastInboundAt: lastAt && !isOut ? lastAt : null,
    lastOutboundAt: lastAt && isOut ? lastAt : null,
    hasInbound: !!hasInbound,
    lastReadOutboxId:
      outboxRaw !== undefined &&
      outboxRaw !== null &&
      String(outboxRaw) !== "0"
        ? String(outboxRaw)
        : null,
  };
}

// Только nice-to-have поля, которые sync endpoint синхронно НЕ пишет —
// их источник истины — этот handler. supergroup_id здесь не пишем: его
// уже положил sync (это идентификатор, по нему и WHERE).
function mapSupergroupMeta(sg: SupergroupPayload): Record<string, unknown> {
  return {
    boost_level: sg.boost_level,
    is_verified: sg.verification_status?.is_verified ?? false,
    is_channel: sg.is_channel,
    is_broadcast_group: sg.is_broadcast_group,
    has_dm: sg.has_direct_messages_group,
    has_linked_chat: sg.has_linked_chat,
    // supergroup.date — int32 unix timestamp создания канала.
    created_at_tg: sg.date,
  };
}

function mapUser(user: UserPayload): UserRow | null {
  // Regular — живой собеседник; Bot — тоже храним (этап 16.9: бот = контакт,
  // менеджер общается с админом через бота). Deleted/Unknown — мёртвый,
  // помечаем флагом (tg_users.is_deleted), чтобы lookup'ы отсеивали без
  // повторного searchPublicChat.
  const isDeleted =
    user.type._ === "userTypeDeleted" || user.type._ === "userTypeUnknown";
  if (
    !isDeleted &&
    user.type._ !== "userTypeRegular" &&
    user.type._ !== "userTypeBot"
  )
    return null;
  const status = mapUserStatus(user.status);
  return {
    userId: String(user.id),
    username: extractActiveUsername(user),
    fullName: extractFullName(user),
    isDeleted,
    isBot: user.type._ === "userTypeBot",
    ...(status
      ? { isOnline: status.isOnline, lastSeenAt: status.lastSeenAt }
      : {}),
  };
}

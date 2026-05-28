import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  projectItems,
  projectImports,
  properties as propsTable,
  scheduledMessages,
  tgChats,
  tgUsers,
} from "../db/schema.ts";
import {
  contactTgUserIdSql,
  contactUsernameSql,
} from "./contact-sql.ts";
import {
  loadPropertyDefs,
  validateContactProperties,
} from "./contact-properties.ts";
import { emitContactChanged, emitProjectChanged } from "./events.ts";
import { FINAL_OFFER_MSG_IDX } from "./project-scheduling.ts";
import { errMsg } from "./errors.ts";
import type { TdClient } from "./tdlib/index.ts";
import { extractActiveUsername, extractFullName } from "./tdlib/td-user.ts";

// In-memory map (account+chat+placeholder → scheduledMessageId) для
// updateMessageSendFailed. Worker оптимистично пишет sent; failed-апдейт
// переводит row в failed. После рестарта map пуст, единичный апдейт может
// потеряться — окно секунды, принимаем.
const pendingSends = new Map<string, string>();
const k = (a: string, c: string, p: string) => `${a}:${c}:${p}`;
export function rememberPendingSend(a: string, c: string, p: string, id: string) {
  pendingSends.set(k(a, c, p), id);
}

// Inbound listener: подписываем глобальный update-handler за каждый authorized
// outreach-account TDLib-инстанс. На каждое incoming DM от человека, который у
// нас в project_items (по tg_user_id + workspace_id), помечаем `replied_at` и
// отменяем все его pending scheduled_messages во всех его sequences. Параллельно
// зеркалим unread у contacts.
//
// tg_user_id у лида заполняется воркером после первой успешной отправки. Если
// лид нам ещё не написан — нет tgUserId — нет матча. «остановить sequence на
// ответ» имеет смысл только когда мы УЖЕ что-то послали.

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}

// Минимальные локальные типы для updates, которые мы реально используем.
// Полная схема — в `tdlib-types`, но цеплять её здесь не обязательно.
type TdMessageSender =
  | { _: "messageSenderUser"; user_id: number }
  | { _: "messageSenderChat"; chat_id: number };
type TdMessage = {
  _: "message";
  id: number;
  chat_id: number;
  sender_id: TdMessageSender;
  is_outgoing: boolean;
};
type HandlerEntry = {
  handler: (update: unknown) => void;
};
const handlers = new Map<string, HandlerEntry>();

export function attachListener(
  accountId: string,
  workspaceId: string,
  client: TdClient,
): void {
  if (handlers.has(accountId)) return;

  const handler = (update: unknown) => {
    try {
      const u = update as { _?: string };
      switch (u._) {
        case "updateNewMessage": {
          const msg = (update as { message: TdMessage }).message;
          void onNewMessage(accountId, workspaceId, client, msg);
          return;
        }
        case "updateChatReadInbox": {
          const x = update as { chat_id: number; unread_count: number };
          void onReadInbox(workspaceId, x.chat_id, x.unread_count);
          return;
        }
        case "updateChatReadOutbox": {
          const x = update as {
            chat_id: number;
            last_read_outbox_message_id: number | string;
          };
          void onReadOutbox(
            accountId,
            workspaceId,
            x.chat_id,
            String(x.last_read_outbox_message_id),
          );
          return;
        }
        case "updateDeleteMessages": {
          // is_permanent=true — peer/мы реально удалили; false (или
          // from_cache=true) — внутренние очистки TDLib, не показатель
          // действий пользователя. Дёргаем invalidate только на реальные.
          const x = update as {
            chat_id: number;
            is_permanent: boolean;
            from_cache?: boolean;
          };
          if (!x.is_permanent || x.from_cache) return;
          void emitChatChangedForContact(workspaceId, x.chat_id);
          return;
        }
        case "updateMessageSendSucceeded": {
          // Worker уже написал sent — нам нужно только убрать ключ из map,
          // иначе на typical-path (>99% sends) Map течёт навсегда.
          const x = update as {
            message: { chat_id: number | string };
            old_message_id: number | string;
          };
          pendingSends.delete(
            k(accountId, String(x.message.chat_id), String(x.old_message_id)),
          );
          return;
        }
        case "updateMessageSendFailed": {
          const x = update as {
            message: { chat_id: number | string };
            old_message_id: number | string;
            error?: { message?: string };
          };
          void onSendFailed(
            accountId,
            String(x.message.chat_id),
            String(x.old_message_id),
            x.error?.message ?? "send failed",
          );
          return;
        }
      }
    } catch (e) {
      console.error(
        `[outreach-listener] dispatch ${accountId}:`,
        errMsg(e),
      );
    }
  };
  client.on("update", handler);
  handlers.set(accountId, { handler });
}

export function detachListener(accountId: string, client: TdClient): void {
  const entry = handlers.get(accountId);
  if (!entry) return;
  try {
    client.off("update", entry.handler);
  } catch {
    // client may be already closed
  }
  handlers.delete(accountId);
}

async function onNewMessage(
  accountId: string,
  workspaceId: string,
  client: TdClient,
  msg: TdMessage,
): Promise<void> {
  // Юзер пишет клиенту мимо CRM (с телефона / в TWA-iframe / через worker).
  // Если контакта ещё нет — создаём, чтобы база автопополнялась. Sticky НЕ
  // ставим: правило v2 «kто последним получил ответ» — исходящему без
  // ответа sticky не положен.
  if (msg.is_outgoing) {
    if (msg.chat_id <= 0) return; // только private DM
    try {
      await ensureContactFromTraffic({
        workspaceId,
        accountId,
        client,
        peerUserId: String(msg.chat_id),
        ts: new Date(),
        isInbound: false,
      });
    } catch (e) {
      console.error(
        `[outreach-listener] outgoing ensure ${accountId}:`,
        errMsg(e),
      );
    }
    return;
  }
  // Только private DM от user'а — sender = messageSenderUser, и в TDLib
  // private chat_id == user_id. Боты технически тоже user'ы, но бот не
  // пишет нам сам, если мы не подписались.
  if (msg.sender_id._ !== "messageSenderUser") return;
  const senderUserId = msg.sender_id.user_id;
  if (msg.chat_id !== senderUserId) return;
  const senderIdStr = String(senderUserId);

  try {
    // Outreach-лид → отметка repliedAt + отмена pending sequence-сообщений.
    const updated = await db
      .update(projectItems)
      .set({ repliedAt: new Date() })
      .where(
        and(
          eq(projectItems.workspaceId, workspaceId),
          eq(projectItems.tgUserId, senderIdStr),
          isNull(projectItems.repliedAt),
        ),
      )
      .returning();

    if (updated.length > 0) {
      const leadIds = updated.map((u) => u.id);
      const cancelled = await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead replied" })
        .where(
          and(
            eq(scheduledMessages.status, "pending"),
            inArray(scheduledMessages.itemId, leadIds),
            // только холодную цепочку — финальный оффер на ответ не гасим.
            lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
          ),
        )
        .returning({ projectId: scheduledMessages.projectId });
      for (const projectId of new Set(cancelled.map((r) => r.projectId))) {
        emitProjectChanged(projectId);
      }
    }

    // unread_count поверх contacts держит onReadInbox: TG на каждое incoming
    // шлёт парный updateChatReadInbox с новым unread_count, это authoritative
    // (см. td_api.tl: «Incoming messages were read OR the number of unread
    // messages has been changed»). Если делать +1 здесь — гонимся с onReadInbox
    // и получаем +2 на первое сообщение в чат. Тут только bump lastMessageAt
    // + first-write-wins sticky (COALESCE).
    const now = new Date();
    let touched = await db
      .update(contacts)
      .set({
        lastMessageAt: now,
        primaryAccountId: sql`COALESCE(${contacts.primaryAccountId}, ${accountId})`,
      })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          sql`${contactTgUserIdSql} = ${senderIdStr}`,
        ),
      )
      .returning({
        id: contacts.id,
        unreadCount: contacts.unreadCount,
      });

    // Fallback: контакт может быть создан вручную с telegram_username, но без
    // tg_user_id. Резолвим через реплику и инжектим tg_user_id в properties —
    // следующий incoming сразу попадёт в быстрый путь.
    if (touched.length === 0) {
      const [u] = await db
        .select({ username: tgUsers.username })
        .from(tgUsers)
        .where(eq(tgUsers.userId, senderIdStr))
        .limit(1);
      const username = u?.username ?? null;
      if (username) {
        touched = await db
          .update(contacts)
          .set({
            lastMessageAt: now,
            primaryAccountId: sql`COALESCE(${contacts.primaryAccountId}, ${accountId})`,
            properties: sql`${contacts.properties} || jsonb_build_object('tg_user_id', ${senderIdStr}::text)`,
          })
          .where(
            and(
              eq(contacts.workspaceId, workspaceId),
              sql`${contactUsernameSql} = ${username}`,
              sql`${contactTgUserIdSql} IS NULL`,
            ),
          )
          .returning({
            id: contacts.id,
            unreadCount: contacts.unreadCount,
          });
      }
    }

    // Ни fast-path, ни username-fallback не нашли контакт — первое входящее
    // от незнакомца (бизнес работает мимо CRM). Создаём contact и ставим
    // sticky на этот аккаунт (правило v2: входящее = «получил ответ»).
    if (touched.length === 0) {
      try {
        await ensureContactFromTraffic({
          workspaceId,
          accountId,
          client,
          peerUserId: senderIdStr,
          ts: now,
          isInbound: true,
        });
      } catch (e) {
        console.error(
          `[outreach-listener] inbound ensure ${accountId}:`,
          errMsg(e),
        );
      }
      // emit на новый contact идёт изнутри ensureContactFromTraffic.
      return;
    }

    for (const t of touched) {
      emitContactChanged(workspaceId, {
        contactId: t.id,
        unreadCount: t.unreadCount,
        lastMessageAt: now.toISOString(),
      });
    }
  } catch (e) {
    console.error(
      `[outreach-listener] onNewMessage ${accountId}:`,
      errMsg(e),
    );
  }
}

async function onReadInbox(
  workspaceId: string,
  chatId: number,
  unreadCount: number,
): Promise<void> {
  if (chatId <= 0) return; // только private DM
  const tgUserIdStr = String(chatId);
  try {
    const touched = await db
      .update(contacts)
      .set({ unreadCount })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          sql`${contactTgUserIdSql} = ${tgUserIdStr}`,
          sql`${contacts.unreadCount} <> ${unreadCount}`,
        ),
      )
      .returning({
        id: contacts.id,
        unreadCount: contacts.unreadCount,
        lastMessageAt: contacts.lastMessageAt,
      });
    for (const t of touched) {
      emitContactChanged(workspaceId, {
        contactId: t.id,
        unreadCount: t.unreadCount,
        lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
      });
    }
  } catch (e) {
    console.error("[outreach-listener] onReadInbox:", errMsg(e));
  }
}

async function onSendFailed(
  accountId: string,
  chatId: string,
  oldMessageId: string,
  errText: string,
): Promise<void> {
  const key = k(accountId, chatId, oldMessageId);
  const id = pendingSends.get(key);
  if (!id) return;
  pendingSends.delete(key);
  try {
    const rows = await db
      .update(scheduledMessages)
      .set({ status: "failed", error: errText, sentAt: null })
      .where(eq(scheduledMessages.id, id))
      .returning({ projectId: scheduledMessages.projectId });
    if (rows[0]) emitProjectChanged(rows[0].projectId);
  } catch (e) {
    console.error("[outreach-listener] onSendFailed:", errMsg(e));
  }
}

// Шлёт contact event для контакта по tg_user_id (=chat_id в private DM).
// Используется когда нет своего payload'а с unreadCount/lastMessageAt — фронт
// в drawer'е инвалидирует chat-history и подтягивает свежее. Тихо
// no-op если contact'а в CRM нет.
async function emitChatChangedForContact(
  workspaceId: string,
  chatId: number,
): Promise<void> {
  if (chatId <= 0) return;
  const tgUserIdStr = String(chatId);
  try {
    const [contactRow] = await db
      .select({
        id: contacts.id,
        unreadCount: contacts.unreadCount,
        lastMessageAt: contacts.lastMessageAt,
      })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          sql`${contactTgUserIdSql} = ${tgUserIdStr}`,
        ),
      )
      .limit(1);
    if (!contactRow) return;
    emitContactChanged(workspaceId, {
      contactId: contactRow.id,
      unreadCount: contactRow.unreadCount,
      lastMessageAt: contactRow.lastMessageAt?.toISOString() ?? null,
    });
  } catch (e) {
    console.error("[outreach-listener] emitChatChangedForContact:", errMsg(e));
  }
}

async function onReadOutbox(
  accountId: string,
  workspaceId: string,
  chatId: number,
  lastReadOutboxId: string,
): Promise<void> {
  if (chatId <= 0) return;
  const tgUserIdStr = String(chatId);
  const now = new Date();
  try {
    // Синхронный UPDATE tg_chats — replicator пишет тот же patch'ем, но
    // буферизованно (FLUSH_MS=500). Без этого emit ниже улетит раньше
    // записи и SELECT в chat-history endpoint вернёт старое значение.
    await db
      .update(tgChats)
      .set({
        lastReadOutboxId: sql`greatest(${tgChats.lastReadOutboxId}::bigint, ${lastReadOutboxId}::bigint)::text`,
        updatedAt: now,
      })
      .where(
        and(
          eq(tgChats.accountId, accountId),
          eq(tgChats.chatId, String(chatId)),
        ),
      );

    const updated = await db
      .update(scheduledMessages)
      .set({ readAt: now })
      .where(
        and(
          eq(scheduledMessages.workspaceId, workspaceId),
          eq(scheduledMessages.status, "sent"),
          isNull(scheduledMessages.readAt),
          inArray(
            scheduledMessages.itemId,
            db
              .select({ id: projectItems.id })
              .from(projectItems)
              .where(
                and(
                  eq(projectItems.workspaceId, workspaceId),
                  eq(projectItems.tgUserId, tgUserIdStr),
                ),
              ),
          ),
        ),
      )
      .returning({ projectId: scheduledMessages.projectId });
    for (const projectId of new Set(updated.map((r) => r.projectId))) {
      emitProjectChanged(projectId);
    }
    // Без contact event drawer не узнает что peer прочитал —
    // updateChatReadOutbox сам по себе не меняет lastMessageAt/unreadCount.
    await emitChatChangedForContact(workspaceId, chatId);
  } catch (e) {
    console.error("[outreach-listener] onReadOutbox:", errMsg(e));
  }
}

async function findContactByTgUserId(
  workspaceId: string,
  tgUserId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, workspaceId),
        sql`${contactTgUserIdSql} = ${tgUserId}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// Автосоздание контакта из живого DM-трафика. peerUserId — собеседник
// (для входящего = sender, для исходящего = chat_id). Ставит sticky только
// для входящих (правило v2: kто последним получил ответ; исходящему без
// ответа sticky не положен).
//
// Пользовательскую инфу берём через TDLib `getUser` (offline в TDLib-кэше),
// чтобы не зависеть от race с replicator-flush'ем (`tg_users` пишется
// батчем раз в FLUSH_MS, в момент onNewMessage записи может ещё не быть).
type TdUserPayload = {
  type: { _: string };
  first_name: string;
  last_name: string;
  usernames?: { active_usernames: string[]; editable_username: string };
};

async function ensureContactFromTraffic(opts: {
  workspaceId: string;
  accountId: string;
  client: TdClient;
  peerUserId: string;
  ts: Date;
  isInbound: boolean;
}): Promise<void> {
  const { workspaceId, accountId, client, peerUserId, ts, isInbound } = opts;

  // Cheap-guard от лишнего getUser/loadPropertyDefs: большинство DM
  // приходят от уже импортированных контактов. ON CONFLICT ниже закрывает
  // оставшийся race — здесь только оптимизация.
  if (await findContactByTgUserId(workspaceId, peerUserId)) return;

  const [tdUser, ownerRow, defs] = await Promise.all([
    (
      client.invoke({
        _: "getUser",
        user_id: Number(peerUserId),
      } as never) as Promise<TdUserPayload>
    ).catch(() => null),
    db
      .select({ ownerUserId: outreachAccounts.ownerUserId })
      .from(outreachAccounts)
      .where(eq(outreachAccounts.id, accountId))
      .limit(1)
      .then((rows) => rows[0]?.ownerUserId),
    loadPropertyDefs(workspaceId),
  ]);

  if (!tdUser) return;
  if (tdUser.type._ !== "userTypeRegular") return;
  if (!ownerRow) return;

  const fullName = extractFullName(tdUser);
  const username = extractActiveUsername(tdUser);

  const allKeys = new Set(defs.map((d) => d.key));
  const rawProps: Record<string, unknown> = {};
  if (allKeys.has("tg_user_id")) rawProps.tg_user_id = peerUserId;
  if (allKeys.has("full_name")) {
    rawProps.full_name = fullName || (username ? `@${username}` : peerUserId);
  }
  if (username && allKeys.has("telegram_username")) {
    rawProps.telegram_username = username;
  }
  const validated = validateContactProperties(defs, rawProps);
  if (!("tg_user_id" in validated)) {
    validated.tg_user_id = peerUserId;
  }

  try {
    const [created] = await db
      .insert(contacts)
      .values({
        workspaceId,
        properties: validated,
        lastMessageAt: ts,
        primaryAccountId: isInbound ? accountId : null,
        createdBy: ownerRow,
      })
      .onConflictDoNothing()
      .returning({ id: contacts.id });
    if (created) {
      emitContactChanged(workspaceId, {
        contactId: created.id,
        unreadCount: 0,
        lastMessageAt: ts.toISOString(),
      });
    }
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

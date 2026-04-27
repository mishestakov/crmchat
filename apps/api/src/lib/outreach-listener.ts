import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  outreachLeads,
  outreachLists,
  outreachSequences,
  properties as propsTable,
  scheduledMessages,
} from "../db/schema";
import { validateContactProperties } from "./contact-properties";
import { emitContactChanged } from "./contact-events";
import { errMsg } from "./errors";
import { emitSequenceChanged } from "./outreach-events";
import { extractActiveUsername, type TdClient, type TdUser } from "./tdlib";

// Inbound listener: подписываем глобальный update-handler за каждый authorized
// outreach-account TDLib-инстанс. На каждое incoming DM от человека, который у
// нас в outreach_leads (по tg_user_id + workspace_id), помечаем `replied_at` и
// отменяем все его pending scheduled_messages во всех его sequences. Параллельно
// зеркалим unread у contacts.
//
// tg_user_id у лида заполняется воркером после первой успешной отправки. Если
// лид нам ещё не написан — нет tgUserId — нет матча. «остановить sequence на
// ответ» имеет смысл только когда мы УЖЕ что-то послали.

const COPY_SAFE_PROPERTY_TYPES = new Set([
  "text",
  "textarea",
  "tel",
  "url",
  "user_select",
]);

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
          const x = update as { chat_id: number };
          void onReadOutbox(workspaceId, x.chat_id);
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
  if (msg.is_outgoing) return;
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
      .update(outreachLeads)
      .set({ repliedAt: new Date() })
      .where(
        and(
          eq(outreachLeads.workspaceId, workspaceId),
          eq(outreachLeads.tgUserId, senderIdStr),
          isNull(outreachLeads.repliedAt),
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
            inArray(scheduledMessages.leadId, leadIds),
          ),
        )
        .returning({ sequenceId: scheduledMessages.sequenceId });
      for (const seqId of new Set(cancelled.map((r) => r.sequenceId))) {
        emitSequenceChanged(seqId);
      }
      for (const lead of updated) {
        try {
          await convertLeadToContact(lead);
        } catch (e) {
          console.error(
            `[outreach-listener] convert lead ${lead.id}:`,
            errMsg(e),
          );
        }
      }
    }

    // Bump unread у contact'а. Локальный «оптимистичный» инкремент: на свежий
    // incoming TG не шлёт UpdateChatReadInbox, только на read action. Когда
    // юзер прочитает чат на телефоне — TG разошлёт update со stillUnreadCount,
    // и onReadInbox синхронизирует БД с правдой TG.
    const now = new Date();
    let touched = await db
      .update(contacts)
      .set({
        unreadCount: sql`${contacts.unreadCount} + 1`,
        lastMessageAt: now,
      })
      .where(
        and(
          eq(contacts.workspaceId, workspaceId),
          sql`${contacts.properties}->>'tg_user_id' = ${senderIdStr}`,
        ),
      )
      .returning({
        id: contacts.id,
        unreadCount: contacts.unreadCount,
      });

    // Fallback: контакт может быть создан вручную с одним telegram_username,
    // без tg_user_id. Резолвим sender'а через getUser, ищем по username, и
    // заодно инжектим tg_user_id в properties — следующий incoming сразу
    // попадёт в быстрый путь по tg_user_id.
    if (touched.length === 0) {
      const user = await client
        .invoke({ _: "getUser", user_id: senderUserId } as never)
        .catch(() => null);
      const username =
        user && typeof user === "object"
          ? extractActiveUsername(user as TdUser)
          : null;
      if (username) {
        touched = await db
          .update(contacts)
          .set({
            unreadCount: sql`${contacts.unreadCount} + 1`,
            lastMessageAt: now,
            properties: sql`${contacts.properties} || jsonb_build_object('tg_user_id', ${senderIdStr}::text)`,
          })
          .where(
            and(
              eq(contacts.workspaceId, workspaceId),
              sql`${contacts.properties}->>'telegram_username' = ${username}`,
              sql`${contacts.properties}->>'tg_user_id' IS NULL`,
            ),
          )
          .returning({
            id: contacts.id,
            unreadCount: contacts.unreadCount,
          });
      }
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
          sql`${contacts.properties}->>'tg_user_id' = ${tgUserIdStr}`,
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

async function onReadOutbox(workspaceId: string, chatId: number): Promise<void> {
  if (chatId <= 0) return;
  const tgUserIdStr = String(chatId);
  const now = new Date();
  try {
    const updated = await db
      .update(scheduledMessages)
      .set({ readAt: now })
      .where(
        and(
          eq(scheduledMessages.workspaceId, workspaceId),
          eq(scheduledMessages.status, "sent"),
          isNull(scheduledMessages.readAt),
          inArray(
            scheduledMessages.leadId,
            db
              .select({ id: outreachLeads.id })
              .from(outreachLeads)
              .where(
                and(
                  eq(outreachLeads.workspaceId, workspaceId),
                  eq(outreachLeads.tgUserId, tgUserIdStr),
                ),
              ),
          ),
        ),
      )
      .returning({ sequenceId: scheduledMessages.sequenceId });
    for (const seqId of new Set(updated.map((r) => r.sequenceId))) {
      emitSequenceChanged(seqId);
    }
  } catch (e) {
    console.error("[outreach-listener] onReadOutbox:", errMsg(e));
  }
}

// convertLeadToContact:
//   - находит contact по tg_user_id (если уже есть — переиспользует);
//   - применяет CRM-автоматизации sequence: contactDefaults +
//     contactDefaultOwnerIds (round-robin);
//   - upsert'ит contactId в outreach_leads.
//
// sequenceId опциональный — для legacy-вызовов из NewMessage без контекста
// конкретной sequence (эта ветка просто работает по дефолтным правилам).
export async function convertLeadToContact(
  lead: typeof outreachLeads.$inferSelect,
  sequenceId?: string,
) {
  if (!lead.tgUserId) return;

  let contactId = await findContactByTgUserId(
    lead.workspaceId,
    lead.tgUserId,
  );

  if (!contactId) {
    const [listRows, seqRows, defs] = await Promise.all([
      db
        .select({ createdBy: outreachLists.createdBy })
        .from(outreachLists)
        .where(eq(outreachLists.id, lead.listId))
        .limit(1),
      sequenceId
        ? db
            .select({
              id: outreachSequences.id,
              contactDefaults: outreachSequences.contactDefaults,
              contactDefaultOwnerIds: outreachSequences.contactDefaultOwnerIds,
              contactOwnerRoundRobin: outreachSequences.contactOwnerRoundRobin,
            })
            .from(outreachSequences)
            .where(eq(outreachSequences.id, sequenceId))
            .limit(1)
        : Promise.resolve([] as {
            id: string;
            contactDefaults: Record<string, unknown>;
            contactDefaultOwnerIds: string[];
            contactOwnerRoundRobin: number;
          }[]),
      db
        .select()
        .from(propsTable)
        .where(eq(propsTable.workspaceId, lead.workspaceId)),
    ]);
    const list = listRows[0];
    if (!list) return;
    const seqRow = seqRows[0] ?? null;
    const safeKeys = new Set(
      defs
        .filter((d) => COPY_SAFE_PROPERTY_TYPES.has(d.type))
        .map((d) => d.key),
    );
    const allKeys = new Set(defs.map((d) => d.key));
    const stageDef = defs.find((d) => d.key === "stage");
    const defaultStageId = stageDef?.values?.[0]?.id;

    const props: Record<string, unknown> = {
      tg_user_id: lead.tgUserId,
    };
    if (safeKeys.has("telegram_username") && lead.username) {
      props.telegram_username = lead.username;
    }
    if (safeKeys.has("phone") && lead.phone) {
      props.phone = lead.phone;
    }
    const fullName =
      (typeof lead.properties.full_name === "string"
        ? lead.properties.full_name
        : "") ||
      lead.username ||
      lead.phone ||
      "Без имени";
    if (safeKeys.has("full_name")) props.full_name = fullName;
    for (const [k, v] of Object.entries(lead.properties)) {
      if (k === "full_name") continue;
      if (k === "telegram_username" || k === "phone" || k === "tg_user_id") {
        continue;
      }
      if (k === "stage") continue;
      if (safeKeys.has(k)) props[k] = v;
    }
    if (allKeys.has("stage") && defaultStageId) props.stage = defaultStageId;

    if (seqRow) {
      for (const [k, v] of Object.entries(seqRow.contactDefaults)) {
        if (props[k] === undefined && allKeys.has(k)) {
          props[k] = v;
        }
      }
      if (seqRow.contactDefaultOwnerIds.length > 0 && allKeys.has("owner_id")) {
        const idx =
          seqRow.contactOwnerRoundRobin %
          seqRow.contactDefaultOwnerIds.length;
        props.owner_id = seqRow.contactDefaultOwnerIds[idx];
        await db
          .update(outreachSequences)
          .set({
            contactOwnerRoundRobin: sql`${outreachSequences.contactOwnerRoundRobin} + 1`,
          })
          .where(eq(outreachSequences.id, seqRow.id));
      }
    }

    const validated = validateContactProperties(defs, props);

    try {
      const [created] = await db
        .insert(contacts)
        .values({
          workspaceId: lead.workspaceId,
          properties: validated,
          createdBy: list.createdBy,
        })
        .returning({ id: contacts.id });
      contactId = created!.id;
      emitContactChanged(lead.workspaceId, {
        contactId,
        unreadCount: 0,
        lastMessageAt: null,
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      contactId = await findContactByTgUserId(
        lead.workspaceId,
        lead.tgUserId,
      );
      if (!contactId) throw e;
    }
  }

  await db
    .update(outreachLeads)
    .set({ contactId })
    .where(eq(outreachLeads.id, lead.id));
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
        sql`${contacts.properties}->>'tg_user_id' = ${tgUserId}`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

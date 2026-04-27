import { Api, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent, Raw } from "telegram/events";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  contacts,
  outreachLeads,
  outreachLists,
  properties as propsTable,
  scheduledMessages,
} from "../db/schema";
import { validateContactProperties } from "./contact-properties";
import { emitContactChanged } from "./contact-events";
import { errMsg } from "./errors";
import { emitSequenceChanged } from "./outreach-events";
import { pickActiveUsername } from "./tg-auth";

// Из всех типов property только эти безопасно копируются «как есть» из
// raw CSV-string без рисков для validateContactProperties:
//   - text/textarea/tel/url/user_select — string без формата
// number/email требуют конкретный формат (CSV даёт string),
// single_select/multi_select требуют валидный option.id — CSV даёт человеческий
// текст. Их пропускаем; юзер дозаполнит вручную из UI карточки контакта.
const COPY_SAFE_PROPERTY_TYPES = new Set([
  "text",
  "textarea",
  "tel",
  "url",
  "user_select",
]);

// postgres SQLSTATE 23505 = unique_violation. postgres-js кладёт код в .code.
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === "23505";
}

// Inbound listener: подписка на NewMessage за каждый authorized outreach-account.
// При входящем DM от человека, который у нас в outreach_leads (по tg_user_id +
// workspace_id), помечаем `replied_at = now()` и отменяем все его pending
// scheduled_messages во всех его sequences.
//
// tg_user_id у лида заполняется воркером после первой успешной отправки (через
// getEntity). Если лид нам ещё не написан — нет tgUserId — нет матча. Это норм:
// «остановить sequence на ответ» имеет смысл только когда мы УЖЕ что-то послали.

type HandlerEntry = {
  newMessage: (event: NewMessageEvent) => unknown;
  newMessageEvent: NewMessage;
  readInbox: (update: Api.TypeUpdate) => unknown;
  readInboxEvent: Raw;
};
const handlers = new Map<string, HandlerEntry>();

export function attachListener(
  accountId: string,
  workspaceId: string,
  client: TelegramClient,
) {
  if (handlers.has(accountId)) return;

  const newMessage = async (event: NewMessageEvent) => {
    try {
      // Только private DM, не группы/каналы — иначе на любое сообщение в любом
      // чате будем дёргать БД. Самая горячая ручка системы под listener'ом.
      if (!event.isPrivate) return;
      const senderId = event.message.senderId;
      if (!senderId) return;
      const senderIdStr = String(senderId);

      // ── Outreach-лид → отметка repliedAt + отмена pending sequence-сообщений.
      // Атомарно: пометить только если ещё не помечен (не перезатираем первый
      // момент ответа), вернуть строки для последующей конвертации.
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

        // Конвертим в контакт ДО bump unread, чтобы новый контакт подхватил +1
        // на этом же входящем (а не следующем).
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

      // ── Bump unread у contact'а. Это локальный «оптимистичный» инкремент:
      // TG не шлёт UpdateReadHistoryInbox на incoming, только на read action.
      // Если юзер прочитает чат на телефоне — TG разошлёт UpdateReadHistoryInbox
      // со stillUnreadCount=N, и наш readInbox-handler ниже синхронизирует БД
      // с правдой TG. То есть наш +1 — temporary, до первого read-event'а.
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
      // без tg_user_id. Резолвим sender'а, ищем по username, и заодно инжектим
      // tg_user_id в properties — при следующем входящем сразу попадём в
      // быстрый путь по tg_user_id.
      if (touched.length === 0) {
        const sender = await event.message.getSender().catch(() => null);
        const username =
          sender instanceof Api.User ? pickActiveUsername(sender) : null;
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
        `[outreach-listener] account ${accountId}:`,
        errMsg(e),
      );
    }
  };

  // ── Зеркало TG: UpdateReadHistoryInbox прилетает когда юзер прочитал чат
  // на ЛЮБОМ устройстве (мобила, web.telegram.org, наш mark-read через
  // messages.ReadHistory). stillUnreadCount = реальное число непрочитанных
  // в чате после действия. Перезаписываем БД этим значением — это и есть
  // "правда". На свежий incoming TG этот update НЕ шлёт (для incoming у нас
  // newMessage-handler выше с +1).
  const readInbox = async (update: Api.TypeUpdate) => {
    try {
      if (!(update instanceof Api.UpdateReadHistoryInbox)) return;
      const peer = update.peer;
      if (!(peer instanceof Api.PeerUser)) return; // только private DM
      const tgUserIdStr = String(peer.userId);
      const stillUnread = update.stillUnreadCount;

      const touched = await db
        .update(contacts)
        .set({ unreadCount: stillUnread })
        .where(
          and(
            eq(contacts.workspaceId, workspaceId),
            sql`${contacts.properties}->>'tg_user_id' = ${tgUserIdStr}`,
            sql`${contacts.unreadCount} <> ${stillUnread}`,
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
      console.error(
        `[outreach-listener] readInbox account ${accountId}:`,
        errMsg(e),
      );
    }
  };

  const newMessageEvent = new NewMessage({ incoming: true });
  const readInboxEvent = new Raw({ types: [Api.UpdateReadHistoryInbox] });
  client.addEventHandler(newMessage, newMessageEvent);
  client.addEventHandler(readInbox, readInboxEvent);
  handlers.set(accountId, {
    newMessage,
    newMessageEvent,
    readInbox,
    readInboxEvent,
  });
}

async function convertLeadToContact(lead: typeof outreachLeads.$inferSelect) {
  if (!lead.tgUserId) return;

  let contactId = await findContactByTgUserId(
    lead.workspaceId,
    lead.tgUserId,
  );

  if (!contactId) {
    // createdBy для нового контакта — берём от того, кто загружал список
    // (это владелец данных). В single-user MVP всё равно один человек.
    const [list] = await db
      .select({ createdBy: outreachLists.createdBy })
      .from(outreachLists)
      .where(eq(outreachLists.id, lead.listId))
      .limit(1);
    if (!list) return; // лист удалён, не за что зацепить createdBy

    // Тянем все property defs workspace одним запросом — используем для:
    //   1) фильтра lead.properties (raw CSV-keys и unsafe-типы пропускаем)
    //   2) дефолтного stage = первая опция preset-property `stage`
    const defs = await db
      .select()
      .from(propsTable)
      .where(eq(propsTable.workspaceId, lead.workspaceId));
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
    // Имя: full_name из CSV если был; иначе username/phone как fallback
    // (контакт без имени в UI выглядит как «Без имени»).
    const fullName =
      (typeof lead.properties.full_name === "string"
        ? lead.properties.full_name
        : "") ||
      lead.username ||
      lead.phone ||
      "Без имени";
    if (safeKeys.has("full_name")) props.full_name = fullName;
    // Остальные CSV-колонки → пропускаем через safeKeys-фильтр (исключает
    // single_select/multi_select/number/email где сырое CSV-string не пройдёт
    // валидацию). Юзер дозаполнит эти поля руками из карточки контакта.
    for (const [k, v] of Object.entries(lead.properties)) {
      if (k === "full_name") continue;
      if (k === "telegram_username" || k === "phone" || k === "tg_user_id") {
        continue;
      }
      if (k === "stage") continue;
      if (safeKeys.has(k)) props[k] = v;
    }
    if (allKeys.has("stage") && defaultStageId) props.stage = defaultStageId;

    // validateContactProperties отвергает unknown keys / неверные значения.
    // Мы уже фильтровали по safeKeys, но валидация ловит крайние случаи
    // (например битый CSV дал не-string значение для text-property).
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
    } catch (e) {
      // Race: параллельный listener-event для того же лида (или другого
      // лида с тем же tg_user_id в этом же workspace) уже вставил контакта.
      // Unique partial index `contacts_workspace_tg_user_id_unique` стрельнул
      // 23505. Перечитываем — теперь existing найдётся.
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

export function detachListener(accountId: string, client: TelegramClient) {
  const entry = handlers.get(accountId);
  if (!entry) return;
  try {
    client.removeEventHandler(entry.newMessage, entry.newMessageEvent);
    client.removeEventHandler(entry.readInbox, entry.readInboxEvent);
  } catch {
    // gramjs может не уметь снять handler если internal-state уже сбит при
    // disconnect — не критично, всё равно сейчас уничтожаем клиента.
  }
  handlers.delete(accountId);
}

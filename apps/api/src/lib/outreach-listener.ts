import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  projectItems,
  projectImports,
  projects,
  properties as propsTable,
  scheduledMessages,
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
import { emitContactChanged } from "./contact-events.ts";
import { errMsg } from "./errors.ts";
import { emitProjectChanged } from "./outreach-events.ts";
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
          ),
        )
        .returning({ projectId: scheduledMessages.projectId });
      for (const projectId of new Set(cancelled.map((r) => r.projectId))) {
        emitProjectChanged(projectId);
      }
      // Когда несколько лидов ответили одним батчем (групповая рассылка),
      // загружаем propsTable один раз и переиспользуем в каждом convert.
      const propsDefs = await db
        .select()
        .from(propsTable)
        .where(eq(propsTable.workspaceId, workspaceId));
      await Promise.all(
        updated.map((lead) =>
          convertLeadToContact(lead, undefined, accountId, propsDefs).catch(
            (e) =>
              console.error(
                `[outreach-listener] convert lead ${lead.id}:`,
                errMsg(e),
              ),
          ),
        ),
      );
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
  } catch (e) {
    console.error("[outreach-listener] onReadOutbox:", errMsg(e));
  }
}

// convertLeadToContact:
//   - находит contact по tg_user_id (если уже есть — переиспользует);
//   - применяет CRM-автоматизации project'а: contactDefaults +
//     contactDefaultOwnerIds (round-robin);
//   - upsert'ит contactId в project_items;
//   - first-write-wins sticky на primary_account_id (если accountId передан).
//
// projectId опциональный — NewMessage-ветка вызывает без контекста проекта.
export async function convertLeadToContact(
  lead: typeof projectItems.$inferSelect,
  projectId?: string,
  accountId?: string,
  cachedPropsDefs?: (typeof propsTable.$inferSelect)[],
) {
  if (!lead.tgUserId) return;

  let contactId = await findContactByTgUserId(
    lead.workspaceId,
    lead.tgUserId,
  );

  if (!contactId) {
    // Грузим проект через lead.projectId — даже если caller не передал
    // projectId, нам нужен project.createdBy для FK contacts.created_by →
    // users.id. Раньше фоллбек был на lead.workspaceId, что давало FK
    // violation в дефолтном sad-path (listener вызывает без projectId).
    const lookupProjectId = projectId ?? lead.projectId;
    const [seqRows, defs] = await Promise.all([
      db
        .select({
          id: projects.id,
          createdBy: projects.createdBy,
          contactDefaults: projects.contactDefaults,
          contactDefaultOwnerIds: projects.contactDefaultOwnerIds,
          contactOwnerRoundRobin: projects.contactOwnerRoundRobin,
        })
        .from(projects)
        .where(eq(projects.id, lookupProjectId))
        .limit(1),
      cachedPropsDefs
        ? Promise.resolve(cachedPropsDefs)
        : db
            .select()
            .from(propsTable)
            .where(eq(propsTable.workspaceId, lead.workspaceId)),
    ]);
    const projectRow = seqRows[0];
    if (!projectRow) return; // race с DELETE project — пропускаем тихо
    const projectCreatedBy = projectRow.createdBy;
    // CRM-автоматизации (contactDefaults + owner round-robin) применяем
    // только когда projectId был передан явно (worker on-first-sent flow).
    // Listener-входы (с undefined) — просто создаём contact с дефолтами.
    const seqRow = projectId ? projectRow : null;
    const safeKeys = new Set(
      defs
        .filter((d) => COPY_SAFE_PROPERTY_TYPES.has(d.type))
        .map((d) => d.key),
    );
    const allKeys = new Set(defs.map((d) => d.key));

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
      if (safeKeys.has(k)) props[k] = v;
    }

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
          .update(projects)
          .set({
            contactOwnerRoundRobin: sql`${projects.contactOwnerRoundRobin} + 1`,
          })
          .where(eq(projects.id, seqRow.id));
      }
    }

    const validated = validateContactProperties(defs, props);

    try {
      const [created] = await db
        .insert(contacts)
        .values({
          workspaceId: lead.workspaceId,
          properties: validated,
          createdBy: projectCreatedBy,
          primaryAccountId: accountId ?? null,
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
  } else if (accountId) {
    await db
      .update(contacts)
      .set({ primaryAccountId: accountId })
      .where(
        and(eq(contacts.id, contactId), isNull(contacts.primaryAccountId)),
      );
  }

  await db
    .update(projectItems)
    .set({ contactId })
    .where(eq(projectItems.id, lead.id));
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
  phone_number: string;
  usernames?: { active_usernames: string[]; editable_username: string };
};

const accountOwnerCache = new Map<string, string>();

async function ensureContactFromTraffic(opts: {
  workspaceId: string;
  accountId: string;
  client: TdClient;
  peerUserId: string;
  ts: Date;
  isInbound: boolean;
}): Promise<void> {
  const { workspaceId, accountId, client, peerUserId, ts, isInbound } = opts;

  const existing = await findContactByTgUserId(workspaceId, peerUserId);
  if (existing) {
    // Контакт уже есть (worker создал, либо предыдущий ensure). Inbound-ветка
    // обновит lastMessageAt/sticky сама в основном UPDATE; outbound — нечего
    // делать сверх того, что worker мог сделать. Здесь — просто выходим.
    return;
  }

  // Параллелим всё, что не зависит друг от друга:
  //  - pendingLead (только outbound) — race-protection с worker.convertLeadToContact
  //  - getUser в TDLib (offline)
  //  - account owner (cached) — для contact.created_by
  //  - property defs — для validateContactProperties
  const cachedOwner = accountOwnerCache.get(accountId);
  const [pendingLead, tdUser, ownerRow, defs] = await Promise.all([
    isInbound
      ? Promise.resolve(undefined)
      : db
          .select({ id: projectItems.id })
          .from(projectItems)
          .where(
            and(
              eq(projectItems.workspaceId, workspaceId),
              eq(projectItems.tgUserId, peerUserId),
              isNull(projectItems.contactId),
            ),
          )
          .limit(1)
          .then((rows) => rows[0]),
    (
      client.invoke({
        _: "getUser",
        user_id: Number(peerUserId),
      } as never) as Promise<TdUserPayload>
    ).catch(() => null),
    cachedOwner
      ? Promise.resolve(cachedOwner)
      : db
          .select({ ownerUserId: outreachAccounts.ownerUserId })
          .from(outreachAccounts)
          .where(eq(outreachAccounts.id, accountId))
          .limit(1)
          .then((rows) => rows[0]?.ownerUserId),
    loadPropertyDefs(workspaceId),
  ]);

  // Worker race-protection: pending outreach-лид с этим peer'ом без contactId
  // = исходящее worker'а; даём worker.convertLeadToContact создать контакт с
  // CRM-автоматизациями (contactDefaults + owner round-robin), не опережаем.
  if (pendingLead) return;
  if (!tdUser) return; // peer недоступен в TDLib
  // Реплицируем только живых не-ботов. Bot/Deleted/Unknown — пропускаем.
  if (tdUser.type._ !== "userTypeRegular") return;
  if (!ownerRow) return;
  if (!cachedOwner) accountOwnerCache.set(accountId, ownerRow);
  const ownerUserId = ownerRow;

  const fullName = extractFullName(tdUser);
  const username = extractActiveUsername(tdUser);
  const phone = tdUser.phone_number || null;

  const allKeys = new Set(defs.map((d) => d.key));
  const rawProps: Record<string, unknown> = {};
  if (allKeys.has("tg_user_id")) rawProps.tg_user_id = peerUserId;
  if (allKeys.has("full_name")) {
    rawProps.full_name = fullName || (username ? `@${username}` : peerUserId);
  }
  if (username && allKeys.has("telegram_username")) {
    rawProps.telegram_username = username;
  }
  if (phone && allKeys.has("phone")) rawProps.phone = phone;
  const validated = validateContactProperties(defs, rawProps);
  // tg_user_id — internal-поле, может не быть в defs; добавляем вручную для
  // unique-constraint и lookup'ов.
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
        createdBy: ownerUserId,
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
    // ON CONFLICT DO NOTHING проглотил → contact создан другим concurrent
    // handler'ом (например, worker.convertLeadToContact в этот же тик).
    // Ничего не делаем: следующий incoming/sticky-update пройдёт по основному
    // пути, sticky встанет через COALESCE.
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
}

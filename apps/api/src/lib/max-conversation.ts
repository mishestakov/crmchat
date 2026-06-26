import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  projectItems,
  scheduledMessages,
} from "../db/schema.ts";
import { FINAL_OFFER_MSG_IDX } from "./project-scheduling.ts";
import { errMsg } from "./errors.ts";
import { emitContactChanged, emitProjectChanged } from "./events.ts";
import {
  getMaxWorkerClient,
  maxDialogChatId,
  resolveMaxPeerUserId,
  setMaxClientCreatedHook,
} from "./max-account-client.ts";
import { accountAccessClause } from "./outreach-access.ts";
import { OPCODES } from "./max/opcodes.ts";
import type { MaxClient } from "./max/index.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";

// Аккаунт для переписки: identity (externalUserId) + сессия для воркер-клиента.
export type MaxConvAccount = {
  id: string;
  workspaceId: string;
  externalUserId: string;
  sessionToken: string | null;
  meta: { deviceId?: string };
};

// Активный MAX-аккаунт воркспейса, доступный пользователю (как pickMaxClient,
// но возвращает строку-аккаунт — для контакт-ручек переписки/отправки).
export async function pickMaxAccount(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<MaxConvAccount | null> {
  const [acc] = await db
    .select({
      id: outreachAccounts.id,
      workspaceId: outreachAccounts.workspaceId,
      externalUserId: outreachAccounts.externalUserId,
      sessionToken: outreachAccounts.sessionToken,
      meta: outreachAccounts.meta,
    })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.platform, "max"),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  if (!acc || !acc.externalUserId) return null;
  return { ...acc, externalUserId: acc.externalUserId };
}

export type MaxDialogMessage = {
  id: string;
  text: string;
  time: string; // ISO
  outgoing: boolean; // sender == self
};

const rec = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;

// История диалога 1-на-1 с контактом: peer userId → XOR-chatId → CHAT_HISTORY.
// Направление по message.sender (== self → исходящее).
export async function fetchMaxDialog(
  account: MaxConvAccount,
  peerRef: string,
  limit = 50,
): Promise<MaxDialogMessage[]> {
  const client = await getMaxWorkerClient(account);
  const peerUserId = await resolveMaxPeerUserId(client, peerRef);
  const chatId = maxDialogChatId(account.externalUserId, peerUserId);
  const res = await client.chatHistory(chatId, {
    backward: limit,
    getMessages: true,
  });
  const msgs = ((rec(res.payload)?.messages as unknown[] | undefined) ?? [])
    .map(rec)
    .filter((m): m is Record<string, unknown> => !!m);
  const out: MaxDialogMessage[] = [];
  for (const m of msgs) {
    if (m.id == null) continue;
    const time = typeof m.time === "number" ? m.time : Number(m.time);
    out.push({
      id: String(m.id),
      text: typeof m.text === "string" ? m.text : "",
      time: new Date(time && time > 0 ? time : Date.now()).toISOString(),
      outgoing: String(m.sender ?? "") === account.externalUserId,
    });
  }
  // Старые сверху, как в чат-ленте.
  out.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}

// --- inbound listener (NOTIF_MESSAGE = cmd=0 push) ---

// Идемпотентность per-instance: reconnect переиспользует тот же инстанс
// (listener сохраняется), эвикт создаёт новый — тот получит обработчик через
// creation-hook (см. ниже). WeakSet вместо символа на объекте.
const attachedClients = new WeakSet<MaxClient>();

// Вешаем обработчик NOTIF_MESSAGE на инстанс клиента.
export function attachMaxListener(
  account: MaxConvAccount,
  client: MaxClient,
): void {
  if (attachedClients.has(client)) return;
  attachedClients.add(client);
  client.on(
    "notify",
    (n: { packet: { opcode: number }; payload: unknown }) => {
      if (n.packet.opcode !== OPCODES.NOTIF_MESSAGE) return;
      void handleMaxInbound(account, n.payload).catch((e) =>
        console.error(`[max-listener] ${account.id}:`, errMsg(e)),
      );
    },
  );
}

// Каждый созданный воркер-клиент (warmup, ленивый, пересоздание после эвикта)
// получает inbound-listener — иначе входящие тихо отваливаются для аккаунтов,
// подключённых после старта, и после reconnect-с-эвиктом. Хук дёргается из
// getMaxWorkerClient (без импорта max-conversation — нет цикла); аккаунт грузим
// по id (у getMaxWorkerClient нет workspaceId/externalUserId).
setMaxClientCreatedHook((accountId, client) => {
  if (attachedClients.has(client)) return;
  void (async () => {
    const [a] = await db
      .select({
        id: outreachAccounts.id,
        workspaceId: outreachAccounts.workspaceId,
        externalUserId: outreachAccounts.externalUserId,
      })
      .from(outreachAccounts)
      .where(eq(outreachAccounts.id, accountId))
      .limit(1);
    if (!a || !a.externalUserId) return;
    attachMaxListener(
      { ...a, externalUserId: a.externalUserId, sessionToken: null, meta: {} },
      client,
    );
  })().catch((e) =>
    console.error(`[max-listener] attach ${accountId}:`, errMsg(e)),
  );
});

async function handleMaxInbound(
  account: MaxConvAccount,
  payload: unknown,
): Promise<void> {
  const msg = rec(rec(payload)?.message);
  if (!msg) return;
  const senderId = String(msg.sender ?? "");
  // Своё эхо (мы сами отправили) — не входящее.
  if (!senderId || senderId === account.externalUserId) return;
  // Только личка: chatId NOTIF'а == XOR-chatId диалога. Аккаунт состоит в
  // каналах/группах (метрики/аутрич) и получает NOTIF и оттуда — пост лида в
  // общем канале НЕ должен метить его «ответил».
  const notifChatId = String(rec(payload)?.chatId ?? "");
  if (notifChatId !== maxDialogChatId(account.externalUserId, senderId)) return;
  const cs = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, account.workspaceId),
        sql`${contacts.properties} ->> 'max_user_id' = ${senderId}`,
      ),
    );
  if (cs.length === 0) return;
  const contactIds = cs.map((c) => c.id);
  // Зеркало TG-listener'а — две независимые оси на входящий ответ:
  //  • ось РАССЫЛКИ: гасим незавершённую холодную цепочку (НЕЗАВИСИМО от
  //    repliedAt — после смены контакта repliedAt уже стоит от прежнего, но
  //    капельницу нового надо погасить). Финальный оффер не трогаем.
  //  • ось ВОРОНКИ: на первом ответе ставим repliedAt (isNull-идемпотентно).
  const itemRows = await db
    .select({ id: projectItems.id })
    .from(projectItems)
    .where(
      and(
        eq(projectItems.workspaceId, account.workspaceId),
        inArray(projectItems.contactId, contactIds),
      ),
    );
  const itemIds = itemRows.map((r) => r.id);
  const cancelled =
    itemIds.length > 0
      ? await db
          .update(scheduledMessages)
          .set({ status: "cancelled", error: "lead replied" })
          .where(
            and(
              eq(scheduledMessages.status, "pending"),
              inArray(scheduledMessages.itemId, itemIds),
              lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
            ),
          )
          .returning({ projectId: scheduledMessages.projectId })
      : [];
  const updated = await db
    .update(projectItems)
    .set({ repliedAt: new Date() })
    .where(
      and(
        eq(projectItems.workspaceId, account.workspaceId),
        inArray(projectItems.contactId, contactIds),
        isNull(projectItems.repliedAt),
      ),
    )
    .returning({ projectId: projectItems.projectId });
  for (const pid of new Set(
    [...cancelled, ...updated].map((u) => u.projectId),
  )) {
    emitProjectChanged(pid);
  }
  // Push в открытую переписку (SSE) — drawer инвалидирует max-history мгновенно,
  // как TG-listener (а не ждёт поллинга). MAX per-contact unread не трекаем → 0.
  const ts = typeof msg.time === "number" ? msg.time : Number(msg.time);
  const lastMessageAt = new Date(ts && ts > 0 ? ts : Date.now()).toISOString();
  for (const cid of contactIds) {
    emitContactChanged(account.workspaceId, {
      contactId: cid,
      unreadCount: 0,
      lastMessageAt,
    });
  }
}

// --- warmup: поднять persistent listener'ы на старте процесса ---

export async function warmupMaxListeners(): Promise<void> {
  try {
    const accounts = await db
      .select({
        id: outreachAccounts.id,
        workspaceId: outreachAccounts.workspaceId,
        externalUserId: outreachAccounts.externalUserId,
        sessionToken: outreachAccounts.sessionToken,
        meta: outreachAccounts.meta,
      })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.platform, "max"),
          eq(outreachAccounts.status, "active"),
        ),
      );
    // getMaxWorkerClient поднимает сокет и через creation-hook вешает listener.
    for (const a of accounts) {
      try {
        await getMaxWorkerClient(a);
      } catch (e) {
        console.error(`[max-listener] warmup ${a.id}:`, errMsg(e));
      }
    }
    console.log(`[max-listener] warmed up ${accounts.length} listener(s)`);
  } catch (e) {
    console.error("[max-listener] warmup failed:", errMsg(e));
  }
}

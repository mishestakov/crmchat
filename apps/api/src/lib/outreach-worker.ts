import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachAccounts,
  outreachLeads,
  outreachSequences,
  scheduledMessages,
  workspaces,
} from "../db/schema";
import { errMsg } from "./errors";
import {
  accountCooldownUntil,
  evictWorkerClient,
  getOutreachWorkerClient,
} from "./outreach-account-client";
import { emitSequenceChanged } from "./outreach-events";
import { convertLeadToContact } from "./outreach-listener";
import { isNowInWindow, startOfDayInTz } from "./outreach-schedule";
import type { TdClient } from "./tdlib";

// Outbound worker для холодных рассылок. Каждый tick:
//   1) забирает pending scheduled_messages где send_at<=now AND sequence.status=active
//   2) группирует по account, кэпит N штук на account за tick
//   3) для каждого account: проверяет workspace.outreachSchedule + per-account
//      daily-limit; шлёт через TDLib с человекоподобной паузой между сообщениями
//   4) автоматически переводит sequence в completed когда нет pending
//
// Concurrency: один tick не пересекается с другим (флаг `tickRunning`); внутри
// tick'а аккаунты обрабатываются параллельно (у каждого свой TDLib-клиент).

const TICK_INTERVAL_MS = 10_000;
const MAX_PER_TICK_GLOBAL = 500;
const MAX_PER_ACCOUNT_PER_TICK = 5;
const MIN_INTER_SEND_PAUSE_MS = 3_000;
const MAX_INTER_SEND_PAUSE_MS = 8_000;

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;


export function startOutreachWorker() {
  if (timer) return;
  console.log(`[outreach-worker] started, tick=${TICK_INTERVAL_MS}ms`);
  timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Eagerly поднимаем все active outreach-аккаунты на старте процесса. TDLib
  // сам держит постоянный TCP к серверам TG и вызывает наш update-handler
  // push'ом. warmup нужен чтобы listener поднялся до первой исходящей —
  // иначе ответы лидов уйдут мимо нас.
  void warmupListeners();
  void tick();
}

async function warmupListeners() {
  try {
    const accounts = await db
      .select({
        id: outreachAccounts.id,
        workspaceId: outreachAccounts.workspaceId,
      })
      .from(outreachAccounts)
      .where(eq(outreachAccounts.status, "active"));
    // Чанки по WARMUP_CONCURRENCY: TDLib инстансы тяжёлые на старте (binlog
    // load + handshake), толпой стартовать дорого по RAM/CPU.
    const WARMUP_CONCURRENCY = 5;
    for (let i = 0; i < accounts.length; i += WARMUP_CONCURRENCY) {
      const batch = accounts.slice(i, i + WARMUP_CONCURRENCY);
      await Promise.all(
        batch.map(async (a) => {
          try {
            await getOutreachWorkerClient(a);
          } catch (e) {
            console.error(
              `[outreach-worker] warmup ${a.id}:`,
              errMsg(e),
            );
          }
        }),
      );
    }
    console.log(
      `[outreach-worker] warmed up ${accounts.length} listener(s)`,
    );
  } catch (e) {
    console.error("[outreach-worker] warmup failed:", errMsg(e));
  }
}

export function stopOutreachWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await runTick();
  } catch (e) {
    console.error("[outreach-worker] tick failed:", errMsg(e));
  } finally {
    tickRunning = false;
  }
}

async function runTick() {
  const now = new Date();
  const due = await db
    .select({
      id: scheduledMessages.id,
      sequenceId: scheduledMessages.sequenceId,
      leadId: scheduledMessages.leadId,
      accountId: scheduledMessages.accountId,
      messageIdx: scheduledMessages.messageIdx,
      text: scheduledMessages.text,
      workspaceId: scheduledMessages.workspaceId,
    })
    .from(scheduledMessages)
    .innerJoin(
      outreachSequences,
      eq(scheduledMessages.sequenceId, outreachSequences.id),
    )
    .where(
      and(
        eq(scheduledMessages.status, "pending"),
        eq(outreachSequences.status, "active"),
        lte(scheduledMessages.sendAt, now),
      ),
    )
    .orderBy(asc(scheduledMessages.sendAt))
    .limit(MAX_PER_TICK_GLOBAL);

  if (due.length === 0) return;

  const byAccount = new Map<string, typeof due>();
  for (const r of due) {
    let list = byAccount.get(r.accountId);
    if (!list) {
      list = [];
      byAccount.set(r.accountId, list);
    }
    if (list.length < MAX_PER_ACCOUNT_PER_TICK) list.push(r);
  }

  await Promise.all(
    [...byAccount.entries()].map(([accountId, items]) =>
      processAccount(accountId, items).catch((e) =>
        console.error(
          `[outreach-worker] account ${accountId}:`,
          e instanceof Error ? (e.stack ?? e.message) : String(e),
        ),
      ),
    ),
  );

  const sequenceIds = [...new Set(due.map((r) => r.sequenceId))];
  await Promise.all(sequenceIds.map((id) => maybeCompleteSequence(id)));
}

type DueItem = {
  id: string;
  sequenceId: string;
  leadId: string;
  accountId: string;
  messageIdx: number;
  text: string;
  workspaceId: string;
};

const NEW_LEAD_MIN_INTERVAL_MS = 60_000;

async function processAccount(accountId: string, items: DueItem[]) {
  const cooldown = accountCooldownUntil.get(accountId);
  if (cooldown && cooldown > Date.now()) return;
  if (cooldown && cooldown <= Date.now()) accountCooldownUntil.delete(accountId);

  // Один JOIN-SELECT вместо двух round-trip'ов: account + outreachSchedule
  // — обе таблицы маленькие, индексы по PK.
  const [row] = await db
    .select({
      account: outreachAccounts,
      outreachSchedule: workspaces.outreachSchedule,
    })
    .from(outreachAccounts)
    .innerJoin(workspaces, eq(workspaces.id, outreachAccounts.workspaceId))
    .where(eq(outreachAccounts.id, accountId))
    .limit(1);
  if (!row || row.account.status !== "active") return;
  const { account, outreachSchedule } = row;

  if (!isNowInWindow(outreachSchedule, new Date())) return;

  // Daily-stats тащим только если в tick'е есть first-message слот (msg_idx=0):
  // для follow-up only это пустая трата round-trip'а.
  const hasFirstMessage = items.some((it) => it.messageIdx === 0);
  let newLeadsRemaining = account.newLeadsDailyLimit;
  let lastNewLeadInTick = 0;
  if (hasFirstMessage) {
    const { newLeadsToday, lastNewLeadAt } = await getNewLeadsStatsToday(
      accountId,
      outreachSchedule.timezone,
    );
    newLeadsRemaining = account.newLeadsDailyLimit - newLeadsToday;
    lastNewLeadInTick = lastNewLeadAt?.getTime() ?? 0;
  }

  const client = await getOutreachWorkerClient({
    id: account.id,
    workspaceId: account.workspaceId,
  });
  if (!client) {
    // Не помечаем unauthorized: spawn мог упасть по временной причине
    // (TDLIB_LIBDIR не проброшен после HMR, dir заблокирован файлами,
    // network blip). status переключаем только когда TDLib явно сообщил
    // logged_out / closed (см. markUnauthorized в outreach-account-client.ts)
    // или sendOne словил AUTH_KEY-style ошибку (см. ниже).
    console.warn(
      `[outreach-worker] worker client unavailable for ${accountId}, retry next tick`,
    );
    return;
  }

  const leadRows = await db
    .select()
    .from(outreachLeads)
    .where(
      inArray(
        outreachLeads.id,
        items.map((it) => it.leadId),
      ),
    );
  const leadById = new Map(leadRows.map((l) => [l.id, l]));

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (newLeadsRemaining <= 0 && item.messageIdx === 0) {
      continue;
    }
    const lead = leadById.get(item.leadId);
    if (!lead) {
      await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead deleted" })
        .where(eq(scheduledMessages.id, item.id));
      emitSequenceChanged(item.sequenceId);
      continue;
    }

    if (lead.repliedAt) {
      const cancelled = await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead replied" })
        .where(
          and(
            eq(scheduledMessages.leadId, item.leadId),
            eq(scheduledMessages.status, "pending"),
          ),
        )
        .returning({ sequenceId: scheduledMessages.sequenceId });
      for (const seqId of new Set(cancelled.map((r) => r.sequenceId))) {
        emitSequenceChanged(seqId);
      }
      continue;
    }

    if (item.messageIdx === 0) {
      const elapsed = Date.now() - lastNewLeadInTick;
      if (elapsed < NEW_LEAD_MIN_INTERVAL_MS) continue;
    }

    try {
      const { tgUserId } = await sendOne(client, lead, item.text);
      const now = new Date();
      await db
        .update(scheduledMessages)
        .set({ status: "sent", sentAt: now })
        .where(eq(scheduledMessages.id, item.id));
      if (tgUserId && !lead.tgUserId) {
        await db
          .update(outreachLeads)
          .set({ tgUserId })
          .where(eq(outreachLeads.id, lead.id));
      }
      emitSequenceChanged(item.sequenceId);
      if (item.messageIdx === 0) {
        newLeadsRemaining--;
        lastNewLeadInTick = now.getTime();

        void maybeCreateContactOnFirstSent(item.sequenceId, item.leadId).catch(
          (e) =>
            console.error(
              `[outreach-worker] convert lead ${item.leadId} on-first-sent:`,
              errMsg(e),
            ),
        );
      }
    } catch (e) {
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        const waitMs = (flood + 5) * 1000;
        accountCooldownUntil.set(accountId, Date.now() + waitMs);
        await db
          .update(scheduledMessages)
          .set({ sendAt: new Date(Date.now() + waitMs) })
          .where(eq(scheduledMessages.id, item.id));
        emitSequenceChanged(item.sequenceId);
        console.warn(
          `[outreach-worker] FloodWait on account ${accountId}: ${flood}s`,
        );
        return;
      }
      const killed = classifyKilled(msg);
      if (killed) {
        await db
          .update(outreachAccounts)
          .set({ status: killed, updatedAt: new Date() })
          .where(eq(outreachAccounts.id, accountId));
        await evictWorkerClient(accountId);
        return;
      }
      if (isPermanentSendError(msg)) {
        await db
          .update(scheduledMessages)
          .set({ status: "failed", error: msg })
          .where(eq(scheduledMessages.id, item.id));
        emitSequenceChanged(item.sequenceId);
      }
    }

    if (i < items.length - 1) {
      await sleep(
        MIN_INTER_SEND_PAUSE_MS +
          Math.random() * (MAX_INTER_SEND_PAUSE_MS - MIN_INTER_SEND_PAUSE_MS),
      );
    }
  }
}

type LeadRow = typeof outreachLeads.$inferSelect;

async function sendOne(
  client: TdClient,
  lead: LeadRow,
  text: string,
): Promise<{ tgUserId: string | null }> {
  if (!lead.username) {
    throw new Error(
      "PHONE_NOT_SUPPORTED — phone-only лиды пока нельзя отправлять, нужен @username",
    );
  }

  // searchPublicChat резолвит @username в Chat. Для DM chat.id == user_id
  // получателя (TDLib convention для chatTypePrivate).
  const chat = (await client.invoke({
    _: "searchPublicChat",
    username: stripAt(lead.username),
  } as never)) as { id: number | string; type?: { _?: string; user_id?: number } };

  await client.invoke({
    _: "sendMessage",
    chat_id: chat.id,
    input_message_content: {
      _: "inputMessageText",
      text: { _: "formattedText", text, entities: [] },
      link_preview_options: { _: "linkPreviewOptions", is_disabled: true },
      clear_draft: false,
    },
  } as never);

  let tgUserId: string | null = null;
  if (chat.type?._ === "chatTypePrivate" && chat.type.user_id != null) {
    tgUserId = String(chat.type.user_id);
  } else if (typeof chat.id === "number" && chat.id > 0) {
    tgUserId = String(chat.id);
  }
  return { tgUserId };
}

function stripAt(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

function parseFloodWaitSeconds(msg: string): number | null {
  // TDLib переписывает MTProto FLOOD_WAIT в "Too Many Requests: retry after N",
  // но для некоторых методов оставляет MTProto-style текст.
  const m1 = msg.match(/retry after (\d+)/i);
  if (m1) return Number(m1[1]);
  const m2 = msg.match(/FLOOD_WAIT_(\d+)/);
  if (m2) return Number(m2[1]);
  const m3 = msg.match(/SLOWMODE_WAIT_(\d+)/);
  if (m3) return Number(m3[1]);
  return null;
}

function isPermanentSendError(msg: string): boolean {
  return /USERNAME_INVALID|USERNAME_NOT_OCCUPIED|PEER_FLOOD|USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|USER_DEACTIVATED|YOU_BLOCKED_USER|CHAT_WRITE_FORBIDDEN|INPUT_USER_DEACTIVATED|PHONE_NOT_SUPPORTED|MESSAGE_EMPTY|MESSAGE_TOO_LONG|No such public user|Username not occupied|Bot can't initiate conversation/i.test(
    msg,
  );
}

// Возвращает либо целевой статус ('unauthorized' | 'banned'), либо null если
// ошибка не «account-killed». unauthorized — auth_key/session протухли (юзер
// сам разлогинил, или TG отозвал); banned — сам аккаунт прибит.
function classifyKilled(msg: string): "unauthorized" | "banned" | null {
  if (/AUTH_KEY_UNREGISTERED|SESSION_(REVOKED|EXPIRED)|^401|Unauthorized/.test(msg)) {
    return "unauthorized";
  }
  if (/USER_DEACTIVATED_BAN/.test(msg)) return "banned";
  return null;
}

async function getNewLeadsStatsToday(
  accountId: string,
  tz: string,
): Promise<{ newLeadsToday: number; lastNewLeadAt: Date | null }> {
  const start = startOfDayInTz(new Date(), tz);
  // postgres-js при биндинге внутри FILTER-клаузы не выводит timestamptz и
  // фейлится на Date.byteLength. Передаём ISO-строку — Postgres сам кастит
  // её к timestamptz через >= оператор.
  const startIso = start.toISOString();
  const [row] = await db
    .select({
      todayCount: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.sentAt} >= ${startIso}::timestamptz)::int`,
      // postgres-js за пределами column-mapping не знает тип max(...) и
      // возвращает строку. Конвертируем сами в Date.
      lastSentAt: sql<string | null>`max(${scheduledMessages.sentAt})`,
    })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.accountId, accountId),
        eq(scheduledMessages.status, "sent"),
        eq(scheduledMessages.messageIdx, 0),
      ),
    );
  return {
    newLeadsToday: row?.todayCount ?? 0,
    lastNewLeadAt: row?.lastSentAt ? new Date(row.lastSentAt) : null,
  };
}

async function maybeCreateContactOnFirstSent(
  sequenceId: string,
  leadId: string,
): Promise<void> {
  const [seq] = await db
    .select({
      contactCreationTrigger: outreachSequences.contactCreationTrigger,
    })
    .from(outreachSequences)
    .where(eq(outreachSequences.id, sequenceId))
    .limit(1);
  if (!seq || seq.contactCreationTrigger !== "on-first-message-sent") return;
  const [lead] = await db
    .select()
    .from(outreachLeads)
    .where(eq(outreachLeads.id, leadId))
    .limit(1);
  if (!lead) return;
  await convertLeadToContact(lead, sequenceId);
}

async function maybeCompleteSequence(seqId: string) {
  // Один UPDATE с NOT EXISTS вместо SELECT-then-UPDATE — экономит round-trip
  // и закрывает race с конкурентным INSERT'ом scheduled_messages.
  const now = new Date();
  await db
    .update(outreachSequences)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(outreachSequences.id, seqId),
        eq(outreachSequences.status, "active"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${scheduledMessages}
          WHERE ${scheduledMessages.sequenceId} = ${seqId}
            AND ${scheduledMessages.status} = 'pending'
        )`,
      ),
    );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

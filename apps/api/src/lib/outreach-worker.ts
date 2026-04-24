import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import { FloodWaitError, SlowModeWaitError } from "telegram/errors";
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
  evictWorkerClient,
  getOutreachWorkerClient,
} from "./outreach-account-client";
import { emitSequenceChanged } from "./outreach-events";
import { isNowInWindow, startOfDayInTz } from "./outreach-schedule";

// Outbound worker для холодных рассылок. Каждый tick:
//   1) забирает pending scheduled_messages где send_at<=now AND sequence.status=active
//   2) группирует по account, кэпит N штук на account за tick
//   3) для каждого account: проверяет workspace.outreachSchedule + per-account
//      daily-limit; шлёт через gramjs с человекоподобной паузой между сообщениями
//   4) автоматически переводит sequence в completed когда нет pending
//
// Concurrency: один tick не пересекается с другим (флаг `tickRunning`); внутри
// tick'а аккаунты обрабатываются параллельно (у каждого свой gramjs-клиент).

const TICK_INTERVAL_MS = 10_000;
const MAX_PER_TICK_GLOBAL = 500;
const MAX_PER_ACCOUNT_PER_TICK = 5;
// Рандомизированная пауза между sends внутри одного аккаунта — чтобы выглядело
// как живой человек, а не bulk-скрипт. Крутить когда поймёт что слишком быстро.
const MIN_INTER_SEND_PAUSE_MS = 3_000;
const MAX_INTER_SEND_PAUSE_MS = 8_000;

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

// Per-account cooldown в памяти. Заполняется при ловле FloodWait/SlowMode —
// account полностью пропускается до этого момента. На рестарт процесса
// потеряется и при первой попытке заново словим тот же FloodWait, начнём
// с новым cooldown'ом — не критично, аккаунт сразу же снова уснёт.
//
// Можно было бы хранить в DB (outreach_accounts.cooldown_until), но это
// rate-limit hint от MTProto — он валиден короткое время, и пере-словить
// тот же error при cold-start не страшнее чем lose pending в.памяти.
const accountCooldownUntil = new Map<string, number>();

export function startOutreachWorker() {
  if (timer) return;
  console.log(`[outreach-worker] started, tick=${TICK_INTERVAL_MS}ms`);
  timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  // Eagerly поднимаем все active outreach-аккаунты на старте процесса.
  // Это НЕ polling: gramjs держит постоянное MTProto TCP-соединение к
  // серверам TG, и наш `addEventHandler(NewMessage)` срабатывает push'ом
  // в момент прихода update'а (миллисекунды). Если не warm'ить — клиент
  // поднимется только при первой исходящей, до этого ответы лидов будут
  // молча идти в эфир мимо нас.
  void warmupListeners();
  void tick();
}

async function warmupListeners() {
  try {
    const accounts = await db
      .select({
        id: outreachAccounts.id,
        workspaceId: outreachAccounts.workspaceId,
        session: outreachAccounts.session,
      })
      .from(outreachAccounts)
      .where(eq(outreachAccounts.status, "active"));
    // Чанки по WARMUP_CONCURRENCY: 50 одновременных MTProto handshake'ов
    // выглядят для TG как подозрительный bulk и могут получить временный
    // ban. По 5 — безопасно и достаточно быстро.
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

  // Группируем по account + лимитим. Лиды распределены round-robin при
  // активации, так что 500 due легко могут разлететься на 5+ аккаунтов.
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
          errMsg(e),
        ),
      ),
    ),
  );

  // После всех отправок — посмотреть какие sequences можно закрыть.
  const sequenceIds = [...new Set(due.map((r) => r.sequenceId))];
  await Promise.all(sequenceIds.map((id) => maybeCompleteSequence(id)));
}

type DueItem = {
  id: string;
  sequenceId: string;
  leadId: string;
  accountId: string;
  text: string;
  workspaceId: string;
};

async function processAccount(accountId: string, items: DueItem[]) {
  const cooldown = accountCooldownUntil.get(accountId);
  if (cooldown && cooldown > Date.now()) return;
  if (cooldown && cooldown <= Date.now()) accountCooldownUntil.delete(accountId);

  const [account] = await db
    .select()
    .from(outreachAccounts)
    .where(eq(outreachAccounts.id, accountId))
    .limit(1);
  if (!account || account.status !== "active") return;

  const [ws] = await db
    .select({ outreachSchedule: workspaces.outreachSchedule })
    .from(workspaces)
    .where(eq(workspaces.id, account.workspaceId))
    .limit(1);
  if (!ws) return;

  if (!isNowInWindow(ws.outreachSchedule, new Date())) return;

  const sentToday = await countSentToday(
    accountId,
    ws.outreachSchedule.timezone,
  );
  let remaining = account.newLeadsDailyLimit - sentToday;
  if (remaining <= 0) return;

  const client = await getOutreachWorkerClient(account);
  if (!client) {
    // Session corrupted (legacy plain или дешифровка не прошла). Mark
    // unauthorized — UI попросит юзера повторно залогиниться.
    await db
      .update(outreachAccounts)
      .set({ status: "unauthorized", updatedAt: new Date() })
      .where(eq(outreachAccounts.id, accountId));
    return;
  }

  // Один SELECT для всех лидов tick'а вместо N+1 в цикле. Worker hot path,
  // экономит N round-trip'ов на каждом аккаунте.
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
    if (remaining <= 0) break;
    const item = items[i]!;
    const lead = leadById.get(item.leadId);
    if (!lead) {
      await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead deleted" })
        .where(eq(scheduledMessages.id, item.id));
      emitSequenceChanged(item.sequenceId);
      continue;
    }

    // Reply-check: лид ответил → не шлём ничего больше, в любой sequence.
    // Listener (outreach-listener.ts) при NewMessage event пишет lead.replied_at
    // и сам отменяет pending. Этот guard НЕ ИЗБЫТОЧНЫЙ — listener-событие
    // могло прилететь в зазоре между runTick→processAccount→этот цикл, когда
    // мы уже взяли scheduled_message в работу. Без перепроверки можем послать
    // лишнее. Не удалять как «дубликат listener'а».
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

    try {
      const { tgUserId } = await sendOne(client, lead, item.text);
      await db
        .update(scheduledMessages)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(scheduledMessages.id, item.id));
      if (tgUserId && !lead.tgUserId) {
        await db
          .update(outreachLeads)
          .set({ tgUserId })
          .where(eq(outreachLeads.id, lead.id));
      }
      emitSequenceChanged(item.sequenceId);
      remaining--;
    } catch (e) {
      if (e instanceof FloodWaitError || e instanceof SlowModeWaitError) {
        // FloodWait — TG явно сказал сколько ждать. Уважаем секунда-в-секунду
        // (+ небольшой jitter), иначе аккаунт быстро прогорит. Применяем
        // ко ВСЕМУ аккаунту, потому что flood-bucket per-account/method.
        const waitMs = (e.seconds + 5) * 1000;
        accountCooldownUntil.set(accountId, Date.now() + waitMs);
        // Сдвинуть send_at этого сообщения чтобы не подбирать его сразу как
        // только cooldown снимется — иначе на тике после cooldown снова
        // словим тот же flood за первое же сообщение.
        await db
          .update(scheduledMessages)
          .set({ sendAt: new Date(Date.now() + waitMs) })
          .where(eq(scheduledMessages.id, item.id));
        // sendAt в UI колонке «Дальше» сдвинулся — push фронту чтобы он
        // увидел новую дату без ожидания следующего sent/failed.
        emitSequenceChanged(item.sequenceId);
        console.warn(
          `[outreach-worker] FloodWait on account ${accountId}: ${e.seconds}s`,
        );
        return;
      }
      const msg = errMsg(e);
      if (isAccountKilledError(msg)) {
        const newStatus: "unauthorized" | "banned" =
          /AUTH_KEY|SESSION_(REVOKED|EXPIRED)/.test(msg)
            ? "unauthorized"
            : "banned";
        await db
          .update(outreachAccounts)
          .set({ status: newStatus, updatedAt: new Date() })
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
      // Иначе (SERVER_ERROR, transient network) — оставляем pending.
    }

    if (i < items.length - 1 && remaining > 0) {
      await sleep(
        MIN_INTER_SEND_PAUSE_MS +
          Math.random() * (MAX_INTER_SEND_PAUSE_MS - MIN_INTER_SEND_PAUSE_MS),
      );
    }
  }
}

type LeadRow = typeof outreachLeads.$inferSelect;

async function sendOne(
  client: TelegramClient,
  lead: LeadRow,
  text: string,
): Promise<{ tgUserId: string | null }> {
  // TODO phone-only: реализовать через `Api.contacts.ImportContacts` с
  // `clientId: bigInt(...)`. big-integer установлен как direct dep, но юзер
  // решил отложить до подтверждения, что фича реально нужна. См. DECISIONS.md
  // секция «Outreach» → «Phone-only лиды (отложено)».
  if (!lead.username) {
    throw new Error(
      "PHONE_NOT_SUPPORTED — phone-only лиды пока нельзя отправлять, нужен @username",
    );
  }

  const sent = await client.sendMessage(lead.username, { message: text });

  // tgUserId извлекаем из самого Message-результата, БЕЗ дополнительного
  // getEntity — иначе на каждое первое сообщение лиду уходит лишний
  // resolveUsername RPC. У DM peerId всегда PeerUser с userId получателя.
  let tgUserId: string | null = null;
  if (sent.peerId instanceof Api.PeerUser) {
    tgUserId = String(sent.peerId.userId);
  }
  return { tgUserId };
}

// Permanent failure: gramjs ошибки которые НЕ исчезнут на следующем tick'е.
// Помечаем scheduled_message=failed чтобы не перевыбирать.
function isPermanentSendError(msg: string): boolean {
  return /USERNAME_INVALID|USERNAME_NOT_OCCUPIED|PEER_FLOOD|USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|USER_DEACTIVATED|YOU_BLOCKED_USER|CHAT_WRITE_FORBIDDEN|INPUT_USER_DEACTIVATED|PHONE_NOT_SUPPORTED|MESSAGE_EMPTY|MESSAGE_TOO_LONG/.test(
    msg,
  );
}

// Account-killed: gramjs ошибки которые означают «аккаунт больше не пригоден»
// — не пытаемся слать с него ничего пока юзер не разберётся.
function isAccountKilledError(msg: string): boolean {
  return /AUTH_KEY_UNREGISTERED|USER_DEACTIVATED_BAN|SESSION_REVOKED|SESSION_EXPIRED/.test(
    msg,
  );
}

async function countSentToday(
  accountId: string,
  tz: string,
): Promise<number> {
  const start = startOfDayInTz(new Date(), tz);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.accountId, accountId),
        eq(scheduledMessages.status, "sent"),
        gte(scheduledMessages.sentAt, start),
      ),
    );
  return row?.count ?? 0;
}

async function maybeCompleteSequence(seqId: string) {
  // Sequence завершена когда ни одного pending не осталось. Cancelled/failed/sent
  // — все терминальные, sequence можно закрыть. UPDATE-условие на status='active'
  // защищает от race: если юзер успел нажать pause, completed не должен
  // перезаписать paused.
  const [row] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(scheduledMessages)
    .where(
      and(
        eq(scheduledMessages.sequenceId, seqId),
        eq(scheduledMessages.status, "pending"),
      ),
    );
  if ((row?.pending ?? 0) > 0) return;
  await db
    .update(outreachSequences)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outreachSequences.id, seqId),
        eq(outreachSequences.status, "active"),
      ),
    );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

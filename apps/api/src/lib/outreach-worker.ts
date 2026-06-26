import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  projectItems,
  projects,
  scheduledMessages,
  tgChats,
  tgUsers,
  workspaces,
} from "../db/schema.ts";
import { errMsg } from "./errors.ts";
import {
  clearAccountCooldown,
  evictWorkerClient,
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
  setAccountCooldown,
} from "./outreach-account-client.ts";
import { recordAccountEvent } from "./account-events.ts";
import {
  getMaxWorkerClient,
  maxDialogChatId,
  maxPeerFromProps,
  resolveMaxPeerUserId,
} from "./max-account-client.ts";
import { emitProjectChanged } from "./events.ts";
import { rememberPendingSend } from "./outreach-listener.ts";
import { inputMessageText } from "./td-message.ts";
import {
  isNowInWindow,
  nextAllowedSendAt,
  PEER_FLOOD_COOLDOWN_REASON,
  peerFloodCooldownUntil,
  startOfDayInTz,
} from "./outreach-schedule.ts";
import {
  delayToMs,
  resolveWarmTgUserIds,
  FINAL_OFFER_MSG_IDX,
} from "./project-scheduling.ts";
import { messagesToOpenerDunning } from "./opener-dunning.ts";
import { failStepAndCancelFollowups } from "./outreach-chain.ts";
import type { OutreachSchedule } from "../db/schema.ts";
import type { TdClient } from "./tdlib/index.ts";

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
// 1 сообщение на аккаунт за tick — иначе human-flow (75-190с на каждое)
// заблокирует Promise.all всего tick'а на 6-16 минут, и остальные 44
// аккаунта будут стоять. Следующее due-сообщение этого аккаунта возьмётся
// на следующем tick'е (через 10с).
const MAX_PER_ACCOUNT_PER_TICK = 1;

// Human-flow: каждое сообщение оборачиваем в openChat → typing → send →
// idle → closeChat, с человекоподобными задержками. Минимальный
// POST_SEND ≥ 60s заменяет старый NEW_LEAD_MIN_INTERVAL_MS-гейт.
const TYPING_MIN_MS = 15_000;
const TYPING_MAX_MS = 40_000;
const POST_SEND_MIN_MS = 60_000;
const POST_SEND_MAX_MS = 150_000;
// Бэкофф для неизвестной ошибки отправки: сдвигаем send_at вперёд, чтобы
// битая «голова» очереди аккаунта не блокировала остальные его сообщения
// (worker берёт 1 msg/аккаунт/tick по самому старому send_at).
const UNKNOWN_ERROR_BACKOFF_MS = 10 * 60_000;

// State через globalThis — иначе при HMR в dev новый module-instance видит
// `timer=null`, стартует свой setInterval, а старый продолжает крутиться в
// замыкании. Два worker'а тянут одни и те же due-row'и → второй отправляет
// в TG раньше чем первый успеет update'нуть status, получаем двойную
// отправку реальному собеседнику. В prod без HMR это эквивалентно
// module-let'у.
type WorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  tickRunning: boolean;
};
const globalRef = globalThis as { __outreachWorker?: WorkerState };
const state: WorkerState = (globalRef.__outreachWorker ??= {
  timer: null,
  tickRunning: false,
});

export function startOutreachWorker() {
  if (state.timer) return;
  console.log(`[outreach-worker] started, tick=${TICK_INTERVAL_MS}ms`);
  state.timer = setInterval(() => {
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
      .where(
        and(
          eq(outreachAccounts.platform, "telegram"),
          eq(outreachAccounts.status, "active"),
        ),
      );
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
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

async function tick() {
  if (state.tickRunning) return;
  state.tickRunning = true;
  try {
    await runTick();
  } catch (e) {
    console.error("[outreach-worker] tick failed:", errMsg(e));
  } finally {
    state.tickRunning = false;
  }
}

async function runTick() {
  const now = new Date();
  const due = await db
    .select({
      id: scheduledMessages.id,
      projectId: scheduledMessages.projectId,
      leadId: scheduledMessages.itemId,
      accountId: scheduledMessages.accountId,
      messageIdx: scheduledMessages.messageIdx,
      dunningRound: scheduledMessages.dunningRound,
      text: scheduledMessages.text,
      stickerSetName: scheduledMessages.stickerSetName,
      stickerUniqueId: scheduledMessages.stickerUniqueId,
      workspaceId: scheduledMessages.workspaceId,
    })
    .from(scheduledMessages)
    .innerJoin(
      projects,
      eq(scheduledMessages.projectId, projects.id),
    )
    .where(
      and(
        eq(scheduledMessages.status, "pending"),
        eq(projects.status, "active"),
        lte(scheduledMessages.sendAt, now),
      ),
    )
    .orderBy(asc(scheduledMessages.sendAt))
    .limit(MAX_PER_TICK_GLOBAL);

  if (due.length === 0) return;

  const byAccount = Map.groupBy(due, (r) => r.accountId);
  for (const items of byAccount.values()) {
    if (items.length > MAX_PER_ACCOUNT_PER_TICK) {
      items.length = MAX_PER_ACCOUNT_PER_TICK;
    }
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

  // Auto-complete (status='done' когда нет pending'ов) убран: manager
  // продолжает работать с проектом после рассылки — двигает канбан, ведёт
  // переписку, отвечает. Финальный статус ставит сам через UI «Завершить».
}

type DueItem = {
  id: string;
  projectId: string;
  leadId: string;
  accountId: string;
  messageIdx: number;
  // Заход пиналки: 0 — холодный авто-догон, 1,2… — ручной взвод (этап C).
  dunningRound: number;
  text: string;
  // Снимок стикер-пинга (котик): если заданы — шлём стикер вместо text.
  stickerSetName: string | null;
  stickerUniqueId: string | null;
  workspaceId: string;
};

async function processAccount(accountId: string, items: DueItem[]) {
  // Один JOIN-SELECT вместо двух round-trip'ов: account + outreachSchedule
  // — обе таблицы маленькие, индексы по PK.
  const [row] = await db
    .select({
      account: outreachAccounts,
      outreachSchedule: workspaces.outreachSchedule,
      mode: workspaces.mode,
    })
    .from(outreachAccounts)
    .innerJoin(workspaces, eq(workspaces.id, outreachAccounts.workspaceId))
    .where(eq(outreachAccounts.id, accountId))
    .limit(1);
  if (!row || row.account.status !== "active") return;
  const { account, outreachSchedule, mode } = row;

  // FloodWait cooldown в БД. Если время не вышло — пропускаем тик. Если
  // вышло — чистим (одной операцией снимаем плашку из UI). До platform-ветвления:
  // cooldown/ручная пауза должны действовать и на MAX-аккаунт.
  if (account.cooldownUntil) {
    if (account.cooldownUntil.getTime() > Date.now()) return;
    await clearAccountCooldown(accountId);
  }

  // MAX-аккаунт — отдельный движок отправки (MAX-клиент, без TDLib-антиспама и
  // котиков). Тот же каданс scheduled_messages, та же human-flow пауза.
  if (account.platform === "max") {
    await processMaxAccount(account, items, outreachSchedule);
    return;
  }

  if (!isNowInWindow(outreachSchedule, new Date())) return;

  const leadRows = await db
    .select()
    .from(projectItems)
    .where(
      inArray(
        projectItems.id,
        items.map((it) => it.leadId),
      ),
    );
  const leadById = new Map(leadRows.map((l) => [l.id, l]));

  // Warm-set: peer когда-либо отвечал нам через любой аккаунт воркспейса.
  // Cold-лиды съедают дневной слот и идут через полный human-flow; warm
  // могут улетать без ограничения по числу — реальный менеджер с тем кто
  // ему уже отвечал общается без оглядки на лимит.
  const peerTgUserIds = [
    ...new Set(
      leadRows
        .map((l) => l.tgUserId)
        .filter((x): x is string => x !== null),
    ),
  ];
  const warmSet = await resolveWarmTgUserIds(
    account.workspaceId,
    peerTgUserIds,
  );
  const isWarm = (lead: LeadRow) =>
    !!lead.tgUserId && warmSet.has(lead.tgUserId);

  // Дневной лимит на cold (новые контакты): считаем уже отправленные
  // сегодня msg_idx=0 кроме warm-peer'ов. Если лимит исчерпан — cold-items
  // ждут завтра, warm идут как обычно.
  // Deleted-lead кейс: leadById может не содержать leadId (лид удалён
  // между select scheduled и select projectItems). Считаем такой как cold
  // — он ниже всё равно уйдёт в "lead deleted" cancel, лимит не съест.
  const hasColdFirstMessage = items.some((it) => {
    if (it.messageIdx !== 0) return false;
    const lead = leadById.get(it.leadId);
    return !lead || !isWarm(lead);
  });
  let newLeadsRemaining = account.newLeadsDailyLimit;
  if (hasColdFirstMessage) {
    const coldSentToday = await countColdFirstMessagesToday(
      account.workspaceId,
      accountId,
      outreachSchedule.timezone,
    );
    newLeadsRemaining = account.newLeadsDailyLimit - coldSentToday;
  }

  const client = await getOutreachWorkerClient({
    id: account.id,
    workspaceId: account.workspaceId,
  });
  if (!client) {
    // Не помечаем unauthorized: spawn мог упасть по временной причине
    // (dir заблокирован файлами, network blip). status переключаем только
    // когда TDLib явно сообщил
    // logged_out / closed (см. markUnauthorized в outreach-account-client.ts)
    // или sendOne словил AUTH_KEY-style ошибку (см. ниже).
    console.warn(
      `[outreach-worker] worker client unavailable for ${accountId}, retry next tick`,
    );
    return;
  }

  for (const item of items) {
    const lead = leadById.get(item.leadId);
    if (!lead) {
      await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead deleted" })
        .where(eq(scheduledMessages.id, item.id));
      emitProjectChanged(item.projectId);
      continue;
    }

    // Ответ блогера гасит ХОЛОДНУЮ цепочку (round 0), но НЕ финальный оффер
    // (msg_idx=FINAL_OFFER_MSG_IDX, адресован ответившим) и НЕ ручной догон
    // (dunning_round≥1, этап C). Ручную пиналку менеджер взводит ОСОЗНАННО как
    // раз на ответившего-и-замолчавшего — у такого лида repliedAt всегда стоит
    // (от прежнего ответа), этот булев-гард его бы убил на первой же отправке.
    // Стоп ручной серии — по РЕАЛЬНОМУ новому входящему (outreach-listener гасит
    // pending) или ручным выключением пиналки, а не по «когда-либо отвечал».
    if (
      lead.repliedAt &&
      item.messageIdx !== FINAL_OFFER_MSG_IDX &&
      item.dunningRound === 0
    ) {
      const cancelled = await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead replied" })
        .where(
          and(
            eq(scheduledMessages.itemId, item.leadId),
            eq(scheduledMessages.status, "pending"),
            lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
          ),
        )
        .returning({ projectId: scheduledMessages.projectId });
      for (const projectId of new Set(cancelled.map((r) => r.projectId))) {
        emitProjectChanged(projectId);
      }
      continue;
    }

    const cold = !isWarm(lead);
    if (item.messageIdx === 0 && cold && newLeadsRemaining <= 0) {
      continue;
    }

    try {
      const sent = await sendMessagePhase(client, lead, item);
      if (!sent) continue; // пауза/отмена за время typing — row остаётся pending
      const { tgUserId, tgChatId, tgPlaceholderId } = sent;
      // Оптимистично sent сразу после возврата TDLib'а — TG уже принял
      // сообщение, юзер должен увидеть «отправлено» в UI без задержки.
      // Залипание-и-закрытие чата выполним ниже, оно влияет только на
      // темп следующих отправок, а не на статус текущей.
      // WHERE status='pending' защищает от race с параллельным cancel
      // (lead replied, quick-send manual takeover, FloodWait reschedule):
      // если кто-то уже перевёл row из pending — наш sent не перетирает.
      // Порядок важен: сначала db.update, потом rememberPendingSend —
      // иначе failed-update, прилетевший до завершения update'а, был бы
      // перетёрт нашим sent.
      const sentUpdate = await db
        .update(scheduledMessages)
        .set({ status: "sent", sentAt: new Date() })
        .where(
          and(
            eq(scheduledMessages.id, item.id),
            eq(scheduledMessages.status, "pending"),
          ),
        )
        .returning({ id: scheduledMessages.id });
      if (sentUpdate.length === 0) {
        // Row уже не pending — кто-то её отменил между нашими send-into-TG
        // и update. В БД оставляем cancel-маркер (правильное намерение
        // системы), TG-отправку откатить нельзя. Цепочку всё равно
        // двигаем: msg_idx+1 если он не отменён, иначе застрянет с
        // sentinel-датой навсегда.
        console.warn(
          `[outreach-worker] sent into TG but row ${item.id} already not pending — race with cancel`,
        );
        await scheduleNextFollowup(item, outreachSchedule);
        continue;
      }
      rememberPendingSend(accountId, tgChatId, tgPlaceholderId, item.id);
      if (!lead.tgUserId) {
        await db
          .update(projectItems)
          .set({ tgUserId })
          .where(eq(projectItems.id, lead.id));
      }
      // BD: закрепляем блогера за этим аккаунтом с ПЕРВОГО (холодного) контакта —
      // чтобы во всех будущих кампаниях его вёл тот же аккаунт (одно контактное
      // лицо на блогера). Только для «ничьих»: primary ещё не задан И блогер
      // никому в воркспейсе не отвечал (иначе холодное исходящее «угнало» бы
      // блогера, ответившего другому аккаунту — см. sticky.ts). Атомарно: WHERE +
      // NOT EXISTS. В agency не закрепляем — там одного блогера ведут разные.
      if (mode === "bd" && lead.contactId && item.messageIdx === 0) {
        await db
          .update(contacts)
          .set({ primaryAccountId: accountId })
          .where(
            and(
              eq(contacts.id, lead.contactId),
              isNull(contacts.primaryAccountId),
              sql`not exists (
                select 1 from ${tgChats}
                where ${tgChats.peerUserId} = ${tgUserId}
                  and ${tgChats.hasInbound} = true
                  and ${tgChats.accountId} in (
                    select ${outreachAccounts.id} from ${outreachAccounts}
                    where ${outreachAccounts.workspaceId} = ${account.workspaceId}
                  )
              )`,
            ),
          );
      }
      emitProjectChanged(item.projectId);
      if (item.messageIdx === 0 && cold) {
        newLeadsRemaining--;
        // Журнал: холодное первое касание — источник счётчика «новым сегодня»
        // и графика. Пишем по факту отправки (cold-статус заморожен на этот
        // момент — правильнее для истории, чем пересчёт задним числом).
        await recordAccountEvent(accountId, "cold_send");
      }
      // Догон msg_idx+1 ждал с sentinel-датой — теперь у него есть точка
      // отсчёта (факт-отправка msg_idx), считаем sendAt = now + delay.
      await scheduleNextFollowup(item, outreachSchedule);
      // Sent уже зафиксирован — ошибки idle/closeChat не должны его
      // откатывать; глотаем тихо, темп этого аккаунта чуть собьётся в
      // редком кейсе и всё.
      try {
        await postSendIdle(client, Number(tgUserId));
      } catch (e) {
        console.warn(
          `[outreach-worker] postSendIdle for ${accountId}:`,
          errMsg(e),
        );
      }
    } catch (e) {
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        const waitMs = (flood + 5) * 1000;
        await setAccountCooldown(
          accountId,
          Date.now() + waitMs,
          `FloodWait ${flood}s`,
        );
        await recordAccountEvent(accountId, "flood_wait", `FloodWait ${flood}s`);
        await db
          .update(scheduledMessages)
          .set({
            sendAt: nextAllowedSendAt(
              outreachSchedule,
              new Date(Date.now() + waitMs),
            ),
          })
          .where(eq(scheduledMessages.id, item.id));
        emitProjectChanged(item.projectId);
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
        await recordAccountEvent(accountId, killed, msg);
        await evictWorkerClient(accountId);
        return;
      }
      // PEER_FLOOD — антиспам TG на письма НОВЫМ/незнакомым (не бан аккаунта).
      // Срока ретрая Telegram не даёт, а повторные cold-заходы во флуде
      // эскалируют к реальному бану. 80/20: поймали раз — весь аккаунт на паузу
      // до начала завтрашнего дня (в tz воркспейса; окно расписания догейтит до
      // рабочего часа). Грубее «только холодных», но безопаснее и проще —
      // переиспользуем cooldown (UI уже показывает «молчит до…»). Сообщение
      // перепланируем на завтра, не failed.
      if (/PEER_FLOOD/i.test(msg)) {
        // Sync-путь: sendMessage кинул PEER_FLOOD до scheduleNextFollowup, так
        // что догон ещё не запланирован — сбрасывать нечего (в отличие от
        // async-пути в outreach-listener.onSendFailed).
        const until = peerFloodCooldownUntil(outreachSchedule.timezone);
        await setAccountCooldown(accountId, until.getTime(), PEER_FLOOD_COOLDOWN_REASON);
        await recordAccountEvent(accountId, "peer_flood");
        // cooldown аккаунта = until (00:00, семантику не трогаем); send_at
        // сообщения — на ближайшее окно (не полночь), чтобы БД/UI = правда.
        await db
          .update(scheduledMessages)
          .set({ sendAt: nextAllowedSendAt(outreachSchedule, until) })
          .where(eq(scheduledMessages.id, item.id));
        emitProjectChanged(item.projectId);
        console.warn(
          `[outreach-worker] PEER_FLOOD on account ${accountId}: пауза до ${until.toISOString()}`,
        );
        return;
      }
      if (msg.startsWith("STICKER_UNAVAILABLE")) {
        // Котик пропал (пак удалён владельцем): НЕ зацикливаем retry (стикер не
        // появится) и НЕ рвём всю серию — гасим только этот пинг и довзводим
        // следующий, догон идёт дальше своим кадансом.
        await db
          .update(scheduledMessages)
          .set({ status: "cancelled", error: msg })
          .where(eq(scheduledMessages.id, item.id));
        await scheduleNextFollowup(item, outreachSchedule);
        emitProjectChanged(item.projectId);
        continue;
      }
      if (isPermanentSendError(msg)) {
        // Шаг провалился окончательно — помечаем failed И гасим догоны лида,
        // как async-листенер (failStepAndCancelFollowups). Иначе следующие
        // шаги вечно висят pending на sentinel «после предыдущего», которого
        // уже не будет.
        await failStepAndCancelFollowups({
          id: item.id,
          itemId: item.leadId,
          messageIdx: item.messageIdx,
          error: msg,
        });
        emitProjectChanged(item.projectId);
        // continue, не return: permanent — ошибка уровня сообщения, не аккаунта
        // (flood/killed выше — уровня аккаунта, там return верен). При текущем
        // кэпе items=1 эквивалентно, но останется корректным если кэп поднимут.
        continue;
      }
      // Неизвестная ошибка. Раньше catch молча проглатывал её, и сообщение
      // оставалось pending — если падала «голова» очереди аккаунта, она каждый
      // tick блокировала все остальные его сообщения, и затык был невидим.
      // Теперь: логируем всегда (повторы в логах = устойчивая проблема) и
      // сдвигаем send_at в хвост, чтобы следующие due-сообщения аккаунта пошли.
      console.error(
        `[outreach-worker] unknown send error, account ${accountId}, msg ${item.id} (@${lead.username}): ${msg}`,
      );
      await db
        .update(scheduledMessages)
        .set({
          sendAt: nextAllowedSendAt(
            outreachSchedule,
            new Date(Date.now() + UNKNOWN_ERROR_BACKOFF_MS),
          ),
        })
        .where(eq(scheduledMessages.id, item.id));
      emitProjectChanged(item.projectId);
    }
  }
}

// MAX-ветка воркера: тот же каданс (scheduled_messages — опенер idx 0 + пинги),
// но отправка через MAX-клиент. Сознательно НЕ переносим TG-антиспам (warm-set,
// суточный лимит на холодных, PEER_FLOOD/FloodWait) и котиков (в MAX пинги
// только текстовые — scheduler не кладёт стикер-снимок). Human-flow паузы те же,
// что у TG. Пир получателя берём из контакта лида (max_user_id / max_link).
async function processMaxAccount(
  account: typeof outreachAccounts.$inferSelect,
  items: DueItem[],
  schedule: OutreachSchedule,
): Promise<void> {
  if (!isNowInWindow(schedule, new Date())) return;
  if (!account.externalUserId) return; // без self-id адресовать XOR-диалог нечем

  // Лид + пир получателя из его контакта одним JOIN. Пир — max_user_id (шлём без
  // сети) предпочтительнее max_link (резолвим LINK_INFO); fromUserId=false →
  // после резолва допишем max_user_id контакту (handleMaxInbound матчит входящие
  // по нему, без него «стоп-на-ответ» не сработает). См. maxPeerFromProps.
  const leadRows = await db
    .select({ lead: projectItems, contactProps: contacts.properties })
    .from(projectItems)
    .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(
      inArray(
        projectItems.id,
        items.map((it) => it.leadId),
      ),
    );
  const leadById = new Map(leadRows.map((r) => [r.lead.id, r.lead]));
  const peerByContact = new Map<
    string,
    { ref: string; fromUserId: boolean }
  >();
  for (const r of leadRows) {
    const peer = maxPeerFromProps(r.contactProps);
    if (r.lead.contactId && peer) peerByContact.set(r.lead.contactId, peer);
  }

  const client = await getMaxWorkerClient({
    id: account.id,
    sessionToken: account.sessionToken,
    meta: account.meta,
  }).catch((e) => {
    // Мёртвая сессия → getMaxWorkerClient уже пометил unauthorized (следующий
    // tick отсечётся по status). Сетевой сбой — ретрай на следующем тике.
    console.warn(
      `[outreach-worker] MAX client unavailable for ${account.id}: ${errMsg(e)}`,
    );
    return null;
  });
  if (!client) return;

  for (const item of items) {
    const lead = leadById.get(item.leadId);
    if (!lead) {
      await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead deleted" })
        .where(eq(scheduledMessages.id, item.id));
      emitProjectChanged(item.projectId);
      continue;
    }

    // Стоп холодной цепочки на ответ (зеркало TG-ветки): repliedAt + round 0.
    // Ручной догон (round≥1) и финальный оффер не гасим.
    if (
      lead.repliedAt &&
      item.messageIdx !== FINAL_OFFER_MSG_IDX &&
      item.dunningRound === 0
    ) {
      const cancelled = await db
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "lead replied" })
        .where(
          and(
            eq(scheduledMessages.itemId, item.leadId),
            eq(scheduledMessages.status, "pending"),
            lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
          ),
        )
        .returning({ projectId: scheduledMessages.projectId });
      for (const pid of new Set(cancelled.map((r) => r.projectId))) {
        emitProjectChanged(pid);
      }
      continue;
    }

    const peer = lead.contactId
      ? peerByContact.get(lead.contactId)
      : undefined;
    if (!peer) {
      // Контакт без max-пира — слать некуда. Гасим шаг и цепочку догонов лида
      // (как permanent в TG-ветке), чтобы pending не висел вечно.
      await failStepAndCancelFollowups({
        id: item.id,
        itemId: item.leadId,
        messageIdx: item.messageIdx,
        error: "no MAX peer (контакт без max_user_id/max_link)",
      });
      emitProjectChanged(item.projectId);
      continue;
    }

    try {
      const peerUserId = await resolveMaxPeerUserId(client, peer.ref);
      if (!peer.fromUserId && lead.contactId) {
        await db
          .update(contacts)
          .set({
            properties: sql`${contacts.properties} || jsonb_build_object('max_user_id', ${peerUserId}::text)`,
          })
          .where(eq(contacts.id, lead.contactId));
      }
      const chatId = maxDialogChatId(account.externalUserId, peerUserId);
      await client.msgTyping(chatId).catch(() => {});
      await sleep(randomMs(TYPING_MIN_MS, TYPING_MAX_MS));

      // Перечитываем статус после typing-окна: проект мог встать на паузу / лид
      // ответить — слать уже нельзя (row остаётся pending, уйдёт после resume).
      const [fresh] = await db
        .select({
          msgStatus: scheduledMessages.status,
          projectStatus: projects.status,
        })
        .from(scheduledMessages)
        .innerJoin(projects, eq(projects.id, scheduledMessages.projectId))
        .where(eq(scheduledMessages.id, item.id))
        .limit(1);
      if (
        !fresh ||
        fresh.msgStatus !== "pending" ||
        fresh.projectStatus !== "active"
      ) {
        continue;
      }

      await client.msgSend(chatId, item.text);
      // WHERE status='pending' защищает от race с cancel (lead replied / пауза).
      await db
        .update(scheduledMessages)
        .set({ status: "sent", sentAt: new Date() })
        .where(
          and(
            eq(scheduledMessages.id, item.id),
            eq(scheduledMessages.status, "pending"),
          ),
        );
      emitProjectChanged(item.projectId);
      // Догон msg_idx+1 ждал с sentinel — теперь есть точка отсчёта.
      await scheduleNextFollowup(item, schedule);
      // Human-flow «фаза 2»: пауза формирует темп между лидами.
      await sleep(randomMs(POST_SEND_MIN_MS, POST_SEND_MAX_MS));
    } catch (e) {
      const msg = errMsg(e);
      // Перманентная ошибка резолва получателя (мёртвая max.ru/u-ссылка: LINK_INFO
      // не вернул contact.id / не распознали — resolveMaxContactRef кидает «MAX: …»)
      // — ретраить бессмысленно: гасим шаг и догоны лида, как permanent в TG-ветке.
      // Иначе опенер на мёртвую ссылку висел бы pending и ретраился вечно.
      if (/^MAX: /.test(msg)) {
        await failStepAndCancelFollowups({
          id: item.id,
          itemId: item.leadId,
          messageIdx: item.messageIdx,
          error: msg,
        });
        emitProjectChanged(item.projectId);
        continue;
      }
      console.error(
        `[outreach-worker] MAX send error, account ${account.id}, msg ${item.id}: ${msg}`,
      );
      // Прочие (сеть/msgSend) — сдвигаем send_at в хвост и ретраим. Мёртвая
      // сессия отсечётся статусом аккаунта на след. тике.
      await db
        .update(scheduledMessages)
        .set({
          sendAt: nextAllowedSendAt(
            schedule,
            new Date(Date.now() + UNKNOWN_ERROR_BACKOFF_MS),
          ),
        })
        .where(eq(scheduledMessages.id, item.id));
      emitProjectChanged(item.projectId);
    }
  }
}

type LeadRow = typeof projectItems.$inferSelect;

// Резолв стикер-пинга (котик) в input_message_content. Ищем стикерсет по имени,
// находим стикер по unique_id (одинаков для всех аккаунтов, td_api.tl:259) и
// шлём по remote file id текущего аккаунта. Пак ставить не надо —
// searchStickerSet работает без установки (is_installed — про клавиатуру).
async function resolveStickerContent(
  client: TdClient,
  setName: string,
  uniqueId: string,
): Promise<unknown> {
  const set = (await client.invoke({
    _: "searchStickerSet",
    name: setName,
    ignore_cache: false,
  } as never)) as {
    stickers?: Array<{
      width: number;
      height: number;
      emoji: string;
      sticker?: { remote?: { id: string; unique_id: string } };
    }>;
  };
  const st = set.stickers?.find((s) => s.sticker?.remote?.unique_id === uniqueId);
  if (!st?.sticker?.remote) {
    // Маркер STICKER_UNAVAILABLE — processAccount гасит этот пинг и идёт дальше,
    // а не зацикливает retry (пак удалён → стикер не вернётся).
    throw new Error(
      `STICKER_UNAVAILABLE: sticker ${uniqueId} not found in set "${setName}"`,
    );
  }
  return {
    _: "inputMessageSticker",
    sticker: { _: "inputFileRemote", id: st.sticker.remote.id },
    width: st.width,
    height: st.height,
    emoji: st.emoji ?? "",
  };
}

// Human-flow «фаза 1»: открыть чат, показать «печатает...», подождать
// случайное typing-окно, отправить сообщение. Возврат — сразу после того
// как TG принял отправку, чтобы caller успел отметить sent в БД и
// инвалидировать UI без задержки на «залипание». Закрывающая фаза —
// postSendIdle ниже, она блокирует обработку следующего лида и формирует
// общий темп.
async function sendMessagePhase(
  client: TdClient,
  lead: LeadRow,
  item: DueItem,
): Promise<{
  tgUserId: string;
  tgChatId: string;
  tgPlaceholderId: string;
} | null> {
  if (!lead.username) {
    throw new Error("lead has no @username — cannot resolve TG user");
  }

  const username = stripAt(lead.username);
  const [cached] = await db
    .select({
      userId: tgUsers.userId,
      isDeleted: tgUsers.isDeleted,
      isBot: tgUsers.isBot,
    })
    .from(tgUsers)
    .where(sql`lower(${tgUsers.username}) = ${username.toLowerCase()}`)
    .limit(1);
  if (cached?.isDeleted) {
    throw new Error(`DELETED_SKIPPED — @${lead.username} no longer exists`);
  }
  // Боты (этап 16.9) теперь в реплике — авто-опенер им не шлём (ручной способ).
  if (cached?.isBot) {
    throw new Error(`BOT_SKIPPED — @${lead.username} is a bot`);
  }

  // Cache hit ⇒ известный не-бот, идём прямо в sendMessage.
  // Cache miss ⇒ unseen username: резолвим через searchPublicChat и
  // проверяем тип через getUser (offline после search'а; userTypeBot из
  // td_api.tl:732 — точная семантика, без эвристики @*bot).
  let userId = cached
    ? Number(cached.userId)
    : await resolveAndCheckNotBot(client, username);

  // Открываем чат. chatTypePrivate convention: chat_id = user_id.
  // На cache-hit user_id взят из tg_users, а его мог зарезолвить ДРУГОЙ аккаунт:
  // в Telegram access_hash пользователя per-account, поэтому этот клиент по
  // «чужому» user_id чат открыть не может ("Chat info not found" / "Chat not
  // found"). В этом случае резолвим публичный чат на ЭТОМ клиенте через
  // searchPublicChat (получаем собственный access_hash) и повторяем openChat.
  // На cache-miss resolveAndCheckNotBot уже отработал на этом клиенте — повтор
  // не нужен (потому и гейтим на cached).
  try {
    await client.invoke({ _: "openChat", chat_id: userId } as never);
  } catch (e) {
    if (cached && /not found/i.test(errMsg(e))) {
      // Резолвим на ЭТОМ клиенте и берём ЕГО user_id: обычно тот же (нужен лишь
      // свой access_hash), но если @username переуказан — актуальный владелец.
      // Переприсваиваем, чтобы sendChatAction/sendMessage ниже шли по нему.
      userId = await resolveAndCheckNotBot(client, username);
      await client.invoke({ _: "openChat", chat_id: userId } as never);
    } else {
      throw e;
    }
  }
  await client.invoke({
    _: "sendChatAction",
    chat_id: userId,
    action: { _: "chatActionTyping" },
  } as never);
  await sleep(randomMs(TYPING_MIN_MS, TYPING_MAX_MS));

  // Typing-окно 15-40с — самое широкое место, где юзер успевает нажать
  // «паузу проекта» или отменить сообщение, а откатить send уже нечем.
  // Перечитываем оба статуса перед фактической отправкой; не active /
  // не pending → выходим, row остаётся как есть (после resume уйдёт).
  const [fresh] = await db
    .select({
      msgStatus: scheduledMessages.status,
      projectStatus: projects.status,
    })
    .from(scheduledMessages)
    .innerJoin(projects, eq(projects.id, scheduledMessages.projectId))
    .where(eq(scheduledMessages.id, item.id))
    .limit(1);
  if (
    !fresh ||
    fresh.msgStatus !== "pending" ||
    fresh.projectStatus !== "active"
  ) {
    await client.invoke({ _: "closeChat", chat_id: userId } as never);
    return null;
  }

  // Стикер-пинг (котик) или текст. Стикер резолвим на лету через
  // searchStickerSet (см. resolveStickerContent) — file_id непереносим между
  // аккаунтами, поэтому храним (setName, uniqueId), а не сам file.
  const inputContent =
    item.stickerSetName && item.stickerUniqueId
      ? await resolveStickerContent(
          client,
          item.stickerSetName,
          item.stickerUniqueId,
        )
      : inputMessageText(item.text);

  const sentMsg = (await client.invoke({
    _: "sendMessage",
    chat_id: userId,
    input_message_content: inputContent,
  } as never)) as { id: number | string; chat_id: number | string };

  return {
    tgUserId: String(userId),
    tgChatId: String(sentMsg.chat_id),
    tgPlaceholderId: String(sentMsg.id),
  };
}

// Human-flow «фаза 2»: «залип на экране» 60-150 сек случайно, потом
// закрыл чат. Эта пауза формирует темп между лидами и заменяет старый
// NEW_LEAD_MIN_INTERVAL_MS-гейт.
async function postSendIdle(client: TdClient, userId: number): Promise<void> {
  await sleep(randomMs(POST_SEND_MIN_MS, POST_SEND_MAX_MS));
  await client.invoke({ _: "closeChat", chat_id: userId } as never);
}

function randomMs(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Пересчёт sendAt для следующего шага цепочки этого лида. До факт-отправки
// msg_idx он лежит с sentinel'ом (FOLLOWUP_PENDING_SENTINEL), worker'у не
// видим. Сейчас у нас есть момент отсчёта — обновляем на now + delay из
// шаблона. Если шага нет (последний msg) или pending уже не существует
// (отменён ответом лида и т.п.) — ничего не делаем.
async function scheduleNextFollowup(
  item: DueItem,
  schedule: OutreachSchedule,
): Promise<void> {
  const nextIdx = item.messageIdx + 1;
  const [proj] = await db
    .select({
      // Пиналка — одна на воркспейс (workspaces.dunning).
      dunning: workspaces.dunning,
      messages: projects.messages,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(eq(projects.id, item.projectId))
    .limit(1);
  if (!proj) return;
  // Переходный мост: каданс из dunning.intervals; для незабэкфилленного воркспейса
  // конвертируем из messages на лету. Пинг с messageIdx=k берёт интервал k-1
  // (intervals 0-based по пингам). Серия кончилась → интервала нет → return.
  const dunning =
    proj.dunning ?? messagesToOpenerDunning(proj.messages).dunning;
  const nextDelay = dunning.intervals[nextIdx - 1];
  if (!nextDelay) return;
  const nextAt = nextAllowedSendAt(
    schedule,
    new Date(Date.now() + delayToMs(nextDelay)),
  );
  await db
    .update(scheduledMessages)
    .set({ sendAt: nextAt })
    .where(
      and(
        eq(scheduledMessages.itemId, item.leadId),
        eq(scheduledMessages.messageIdx, nextIdx),
        // Тот же заход, что у только что отправленного пинга: довзвод не должен
        // цеплять соседний round (cold idx переиспользуется ручными заходами).
        eq(scheduledMessages.dunningRound, item.dunningRound),
        eq(scheduledMessages.status, "pending"),
      ),
    );
}

async function resolveAndCheckNotBot(
  client: TdClient,
  username: string,
): Promise<number> {
  const chat = (await client.invoke({
    _: "searchPublicChat",
    username,
  } as never)) as { type?: { _?: string; user_id?: number } };
  if (chat.type?._ !== "chatTypePrivate" || chat.type.user_id == null) {
    throw new Error(`NOT_PRIVATE — @${username} is not a user account`);
  }
  const user = (await client.invoke({
    _: "getUser",
    user_id: chat.type.user_id,
  } as never)) as { type: { _: string } };
  if (user.type._ === "userTypeBot") {
    throw new Error(`BOT_SKIPPED — @${username} is a bot`);
  }
  return chat.type.user_id;
}

function stripAt(s: string): string {
  return s.startsWith("@") ? s.slice(1) : s;
}

function isPermanentSendError(msg: string): boolean {
  // PEER_FLOOD НЕ здесь: это не permanent, а временный антиспам — обрабатывается
  // отдельной веткой (cooldown аккаунта до завтра), см. processAccount.
  return /USERNAME_INVALID|USERNAME_NOT_OCCUPIED|USER_PRIVACY_RESTRICTED|USER_IS_BLOCKED|USER_DEACTIVATED|YOU_BLOCKED_USER|CHAT_WRITE_FORBIDDEN|INPUT_USER_DEACTIVATED|PHONE_NOT_SUPPORTED|MESSAGE_EMPTY|MESSAGE_TOO_LONG|No such public user|Username not occupied|Bot can't initiate conversation|BOT_SKIPPED|DELETED_SKIPPED|NOT_PRIVATE/i.test(
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

// Дневной лимит «новых контактов» — про cold-peer'ов. Warm (которые нам
// когда-либо отвечали) не съедают слот: реальный менеджер с уже знакомым
// собеседником общается без оглядки на счётчик. Считаем msg_idx=0 sent
// сегодня для peer'ов, которым ни один аккаунт воркспейса ещё не получал
// inbound (tg_chats.has_inbound=false / запись отсутствует).
async function countColdFirstMessagesToday(
  workspaceId: string,
  accountId: string,
  tz: string,
): Promise<number> {
  const startIso = startOfDayInTz(new Date(), tz).toISOString();
  const rows = await db
    .select({ tgUserId: projectItems.tgUserId })
    .from(scheduledMessages)
    .innerJoin(projectItems, eq(projectItems.id, scheduledMessages.itemId))
    .where(
      and(
        eq(scheduledMessages.accountId, accountId),
        eq(scheduledMessages.status, "sent"),
        eq(scheduledMessages.messageIdx, 0),
        gte(scheduledMessages.sentAt, sql`${startIso}::timestamptz`),
      ),
    );
  const peerIds = rows
    .map((r) => r.tgUserId)
    .filter((x): x is string => x !== null);
  if (peerIds.length === 0) return 0;
  const warm = await resolveWarmTgUserIds(workspaceId, peerIds);
  return peerIds.filter((id) => !warm.has(id)).length;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

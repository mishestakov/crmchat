import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { outreachAccounts, projectItems } from "../db/schema.ts";
import { errMsg } from "./errors.ts";
import {
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
  setAccountCooldown,
} from "./outreach-account-client.ts";
import { emitProjectChanged } from "./events.ts";
import {
  extractFormattedText,
  extractMediaThumb,
  type TdContent,
} from "./td-message.ts";
import type { TdClient } from "./tdlib/index.ts";

// Воркер снятия метрик опубликованных постов (фаза «Отчёт»). Менеджер жмёт
// «снять статистику» → размещения уходят в metrics_status='pending' → этот
// воркер разбирает очередь по 1 за tick.
//
// Философия TDLib (НЕ pull «дай данные», а «пользователь смотрит — сервер
// накидывает»):
//   1) getMessageLinkInfo(url) — единственный неизбежный резолв ссылки в
//      chat_id+message. Контент поста (текст/минитамбнейл) и baseline
//      interaction_info берём ОТСЮДА, без повторного getMessage.
//   2) openChat — для каналов апдейты приходят только пока чат открыт
//      (td_api.tl: «in channels all updates are received only for opened chats»).
//   3) viewMessages(force_read) — «пользователь посмотрел пост».
//   4) сервер пушит updateMessageInteractionInfo — ловим one-shot хендлером.
//      Не пришёл за таймаут → fallback на baseline из шага 1.
//   5) closeChat.

const TICK_INTERVAL_MS = 10_000; // 1 проверка в 10с
const HOURLY_CAP = 100; // не больше 100 снятий в час (защита от флуда TG)
const UPDATE_WAIT_MS = 8_000; // сколько ждём push updateMessageInteractionInfo
const INVOKE_TIMEOUT_MS = 15_000; // потолок на один TDLib-invoke

// tdl.invoke без таймаута: если TDLib завис (network / cold handshake), await
// никогда не settle'ится — tickRunning остаётся true и весь воркер мёртв до
// рестарта. Оборачиваем каждый invoke в гонку с таймаутом → reject уйдёт в
// catch runOne, row помечается error, tick освобождается.
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`TDLib ${label} timeout`)),
        INVOKE_TIMEOUT_MS,
      ),
    ),
  ]);
}

// State через globalThis — те же причины, что у outreach-worker'а (HMR в dev
// не должен плодить второй setInterval). hourly — таймстемпы обработанных
// постов за последний час, скользящее окно под HOURLY_CAP.
type WorkerState = {
  timer: ReturnType<typeof setInterval> | null;
  tickRunning: boolean;
  hourly: number[];
};
const globalRef = globalThis as { __metricsWorker?: WorkerState };
const state: WorkerState = (globalRef.__metricsWorker ??= {
  timer: null,
  tickRunning: false,
  hourly: [],
});

export function startMetricsWorker() {
  if (state.timer) return;
  console.log(`[metrics-worker] started, tick=${TICK_INTERVAL_MS}ms`);
  state.timer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
}

export function stopMetricsWorker() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

async function tick() {
  if (state.tickRunning) return;
  state.tickRunning = true;
  try {
    const now = Date.now();
    state.hourly = state.hourly.filter((t) => now - t < 3_600_000);
    if (state.hourly.length >= HOURLY_CAP) return;

    const [row] = await db
      .select({
        id: projectItems.id,
        projectId: projectItems.projectId,
        workspaceId: projectItems.workspaceId,
        postUrl: projectItems.postUrl,
      })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.kind, "placement"),
          eq(projectItems.metricsStatus, "pending"),
          isNotNull(projectItems.postUrl),
        ),
      )
      .orderBy(asc(projectItems.createdAt))
      .limit(1);
    if (!row) return;

    // Резервируем слот в часовом окне ДО обращения к TG: лимит считает
    // попытки (и успех, и фейл — нагрузка на сеть одинаковая).
    state.hourly.push(Date.now());
    await runOne(row);
  } catch (e) {
    console.error("[metrics-worker] tick failed:", errMsg(e));
  } finally {
    state.tickRunning = false;
  }
}

type InteractionInfo = {
  view_count?: number;
  forward_count?: number;
  reactions?: { reactions?: Array<{ total_count?: number }> };
} | null;

async function runOne(row: {
  id: string;
  projectId: string;
  workspaceId: string;
  postUrl: string | null;
}) {
  let accountId: string | null = null;
  try {
    if (!row.postUrl) throw new Error("у размещения нет ссылки на пост");

    // Аккаунт с rate-budget не в cooldown (FloodWait общий для отправки и
    // чтения — не дёргаем забенченный аккаунт, как и outreach-worker).
    const [acc] = await db
      .select({ id: outreachAccounts.id, workspaceId: outreachAccounts.workspaceId })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.workspaceId, row.workspaceId),
          eq(outreachAccounts.status, "active"),
          or(
            isNull(outreachAccounts.cooldownUntil),
            lte(outreachAccounts.cooldownUntil, new Date()),
          ),
        ),
      )
      .limit(1);
    if (!acc) throw new Error("нет активного аккаунта для снятия метрик");
    accountId = acc.id;

    const client = await getOutreachWorkerClient(acc);
    if (!client) throw new Error("TDLib-клиент аккаунта недоступен");

    // Шаг 1: резолв ссылки → chat_id + message (контент + baseline-метрики).
    const link = (await withTimeout(
      client.invoke({ _: "getMessageLinkInfo", url: row.postUrl } as never),
      "getMessageLinkInfo",
    )) as {
      chat_id?: number;
      message?: {
        id?: number;
        chat_id?: number;
        interaction_info?: InteractionInfo;
        content?: TdContent;
      } | null;
    };
    const message = link.message;
    if (!message?.id) {
      throw new Error("пост недоступен (приватный канал, удалён или не вступили)");
    }
    // chat_id берём по truthiness (не ??): и на message, и на link 0 = «не
    // заполнено». NaN/0 → openChat невалиден, handler не матчит, ложный
    // timeout→baseline маскирует ошибку как done.
    const chatId = Number(message.chat_id || link.chat_id);
    const msgId = Number(message.id);
    if (!Number.isFinite(chatId) || chatId === 0) {
      throw new Error("не удалось определить chat_id поста");
    }

    // Шаги 2-5: смотрим пост, ловим свежий push; нет — baseline из шага 1.
    const fresh = await collectFresh(client, chatId, msgId);
    const info: InteractionInfo = fresh ?? message.interaction_info ?? null;

    const reactions =
      info?.reactions?.reactions?.reduce(
        (sum, r) => sum + (r.total_count ?? 0),
        0,
      ) ?? null;

    const content = message.content;
    const text = content ? extractFormattedText(content).text : "";
    const thumb = content ? extractMediaThumb(content) : null;

    await db
      .update(projectItems)
      .set({
        metricsStatus: "done",
        metricsViews: info?.view_count ?? null,
        metricsForwards: info?.forward_count ?? null,
        metricsReactions: reactions,
        metricsCollectedAt: new Date(),
        metricsError: null,
        postSnapshot: {
          text,
          thumbB64: thumb?.b64 ?? null,
          thumbW: thumb?.width ?? null,
          thumbH: thumb?.height ?? null,
        },
      })
      .where(eq(projectItems.id, row.id));
  } catch (e) {
    const msg = errMsg(e);
    // FloodWait на чтении — тот же аккаунт, тот же rate-budget: ставим cooldown
    // через общий helper, чтобы и рассылка перестала дёргать аккаунт.
    const flood = parseFloodWaitSeconds(msg);
    if (flood !== null && accountId) {
      await setAccountCooldown(
        accountId,
        Date.now() + (flood + 5) * 1000,
        `FloodWait ${flood}s (metrics)`,
      );
    }
    await db
      .update(projectItems)
      .set({
        metricsStatus: "error",
        metricsError: msg,
        metricsCollectedAt: new Date(),
      })
      .where(eq(projectItems.id, row.id));
  }
  emitProjectChanged(row.projectId);
}

// openChat → viewMessages(force_read) → ждём updateMessageInteractionInfo
// (или таймаут) → closeChat. Возвращает свежий interaction_info или null.
async function collectFresh(
  client: TdClient,
  chatId: number,
  msgId: number,
): Promise<InteractionInfo> {
  await withTimeout(
    client.invoke({ _: "openChat", chat_id: chatId } as never),
    "openChat",
  );
  try {
    return await new Promise<InteractionInfo>((resolve) => {
      let settled = false;
      const finish = (v: InteractionInfo) => {
        if (settled) return;
        settled = true;
        client.off("update", handler);
        clearTimeout(timer);
        resolve(v);
      };
      const handler = (u: unknown) => {
        const upd = u as {
          _?: string;
          chat_id?: number;
          message_id?: number;
          interaction_info?: InteractionInfo;
        };
        if (
          upd._ === "updateMessageInteractionInfo" &&
          Number(upd.chat_id) === chatId &&
          Number(upd.message_id) === msgId
        ) {
          finish(upd.interaction_info ?? null);
        }
      };
      const timer = setTimeout(() => finish(null), UPDATE_WAIT_MS);
      client.on("update", handler);
      void withTimeout(
        client.invoke({
          _: "viewMessages",
          chat_id: chatId,
          message_ids: [msgId],
          source: null,
          force_read: true,
        } as never),
        "viewMessages",
      ).catch(() => {});
    });
  } finally {
    await withTimeout(
      client.invoke({ _: "closeChat", chat_id: chatId } as never),
      "closeChat",
    ).catch(() => {});
  }
}

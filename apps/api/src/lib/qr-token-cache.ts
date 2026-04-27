import { EventEmitter } from "node:events";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Api, type TelegramClient } from "telegram";
import { errMsg } from "./errors";
import { switchDc } from "./telegram-client";

// TTL = срок жизни QR-токена. До истечения отдаём из кэша; досрочно дропает
// обработчик Api.UpdateLoginToken на pending-клиенте (см. lib/telegram-client.ts),
// который заодно эмитит invalidation в bus → SSE-стрим перечитает state.
const TTL_MS = 30_000;

type Cached = {
  result: Api.auth.LoginToken | Api.auth.LoginTokenSuccess;
  fetchedAt: number;
};

const cache = new Map<string, Cached>();
const bus = new EventEmitter();
bus.setMaxListeners(0);

// Per-key timer для проактивной ротации QR-токена. TG не пушит UpdateLoginToken
// на expiry (только на scan), поэтому без таймера фронт держит протухший QR
// пока юзер ничего не сделает. Таймер дропает кэш ~за секунду до expires →
// SSE-стрим вытащит свежий токен.
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRefresh(cacheKey: QrCacheKey): void {
  const t = refreshTimers.get(cacheKey);
  if (t) {
    clearTimeout(t);
    refreshTimers.delete(cacheKey);
  }
}

function scheduleRefresh(cacheKey: QrCacheKey, expiresUnix: number): void {
  clearRefresh(cacheKey);
  const ms = Math.max(1000, expiresUnix * 1000 - Date.now() - 1000);
  const t = setTimeout(() => {
    refreshTimers.delete(cacheKey);
    dropQrTokenCache(cacheKey);
  }, ms);
  t.unref?.();
  refreshTimers.set(cacheKey, t);
}

// Фабрика cache-key'ев. Раньше callsite'ы писали `outreach:${wsId}` руками —
// опечатка в одном из четырёх мест → invalidation молча не доходит.
export const qrKey = {
  outreach: (wsId: string) => `outreach:${wsId}` as const,
  telegram: (userId: string) => `telegram:${userId}` as const,
};
export type QrCacheKey = ReturnType<(typeof qrKey)[keyof typeof qrKey]>;

const channel = (cacheKey: QrCacheKey) => `qr:${cacheKey}`;

export async function exportLoginTokenCached(
  cacheKey: QrCacheKey,
  client: TelegramClient,
  apiId: number,
  apiHash: string,
): Promise<Api.auth.LoginToken | Api.auth.LoginTokenSuccess> {
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.result;
  }

  let result = (await client.invoke(
    new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
  )) as Api.auth.LoginToken | Api.auth.LoginTokenSuccess | Api.auth.LoginTokenMigrateTo;

  while (result instanceof Api.auth.LoginTokenMigrateTo) {
    await switchDc(client, result.dcId);
    result = (await client.invoke(
      new Api.auth.ImportLoginToken({ token: result.token }),
    )) as Api.auth.LoginToken | Api.auth.LoginTokenSuccess | Api.auth.LoginTokenMigrateTo;
  }

  if (result instanceof Api.auth.LoginToken || result instanceof Api.auth.LoginTokenSuccess) {
    cache.set(cacheKey, { result, fetchedAt: Date.now() });
  }
  if (result instanceof Api.auth.LoginToken) {
    scheduleRefresh(cacheKey, Number(result.expires));
  }

  return result;
}

export function dropQrTokenCache(cacheKey: QrCacheKey): void {
  clearRefresh(cacheKey);
  cache.delete(cacheKey);
  bus.emit(channel(cacheKey));
}

export function subscribeQrInvalidation(
  cacheKey: QrCacheKey,
  cb: () => void,
): () => void {
  const ch = channel(cacheKey);
  bus.on(ch, cb);
  return () => bus.off(ch, cb);
}

export function streamQrState<S>(
  c: Context,
  cacheKey: QrCacheKey,
  readState: () => Promise<S>,
  // Terminal-state predicate: после доставки такого state отключаем дальнейшие
  // sends. Иначе password_needed (TG бросает SESSION_PASSWORD_NEEDED) или
  // success могут залупить bus → send → readState → дроп кэша → bus → ...
  // Pending-клиент нужен ровно один раз для checkPassword/afterAuth — нельзя
  // его забивать ExportLoginToken'ом параллельно.
  isTerminal?: (state: S) => boolean,
): Response {
  return streamSSE(c, async (stream) => {
    let closed = false;
    let inflight: Promise<void> | null = null;
    // dirty: если invalidation прилетела во время inflight, после завершения
    // нужно перезапустить send'у. Иначе LoginTokenSuccess из второго push'a
    // потеряется (особенно если первый send вернул из cache pre-drop результат).
    let dirty = false;
    let lastSent: string | null = null;

    const send = (): Promise<void> => {
      if (closed) return Promise.resolve();
      if (inflight) {
        dirty = true;
        return inflight;
      }
      inflight = (async () => {
        try {
          const state = await readState();
          if (closed) return;
          const payload = JSON.stringify(state);
          // gramjs возвращает один и тот же LoginToken пока TG не пушнул
          // UpdateLoginToken — без guard'а каждый ping/poll триггерил re-render.
          if (payload === lastSent) return;
          lastSent = payload;
          await stream.writeSSE({ event: "state", data: payload });
          if (isTerminal?.(state)) {
            closed = true;
          }
        } catch (e) {
          if (closed) return;
          await stream
            .writeSSE({
              event: "error",
              data: JSON.stringify({ message: errMsg(e) }),
            })
            .catch(() => {});
        }
      })().finally(() => {
        inflight = null;
        if (dirty && !closed) {
          dirty = false;
          void send();
        }
      });
      return inflight;
    };

    const unsub = subscribeQrInvalidation(cacheKey, () => void send());
    stream.onAbort(() => {
      closed = true;
      unsub();
    });

    await send();

    // Heartbeat против idle-timeout прокси.
    //   1. abortP создаётся ОДИН раз вне цикла. Раньше каждый цикл делал
    //      `new Promise(r => stream.onAbort(r))` → onAbort пушит в массив
    //      subscribers без pop'а на resolve, и за час stream'а копились
    //      десятки никогда-не-вызываемых listeners.
    //   2. stream.sleep — голый setTimeout без cancellation. Заворачиваем
    //      в cancellableSleep → на abort/close дёргаем clearTimeout, иначе
    //      «зомби-таймер» дотикивает до конца 25с и держит event-loop.
    const abortP = new Promise<void>((resolve) => stream.onAbort(resolve));
    while (!stream.aborted && !closed) {
      const sleep = cancellableSleep(25_000);
      try {
        await Promise.race([sleep.promise, abortP]);
      } finally {
        sleep.cancel();
      }
      if (stream.aborted || closed) break;
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        break;
      }
    }
  });
}

function cancellableSleep(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timer = null;
      resolve();
    }, ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

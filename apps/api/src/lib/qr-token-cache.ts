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

  return result;
}

export function dropQrTokenCache(cacheKey: QrCacheKey): void {
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

    // Heartbeat против idle-timeout прокси. stream.sleep — голый setTimeout,
    // не реагирует на abort → race с promise-of-abort, иначе request висит до
    // 25с после disconnect, держа listener bus и pending TimerHandle.
    const abortP = new Promise<void>((resolve) => stream.onAbort(resolve));
    while (!stream.aborted && !closed) {
      await Promise.race([stream.sleep(25_000), abortP]);
      if (stream.aborted || closed) break;
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        break;
      }
    }
  });
}

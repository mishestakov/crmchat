import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { errMsg } from "../errors";
import type { AuthStateBus } from "./auth-state";

// SSE-стрим текущего auth-state для UI. На каждый push событием 'state' летит
// JSON, переведённый из AuthStateBus в форму, которую ждёт фронт. Heartbeat
// ping каждые 25с против idle-timeout прокси.

export function streamAuthState<S>(
  c: Context,
  bus: AuthStateBus,
  read: () => Promise<S> | S,
  isTerminal?: (s: S) => boolean,
): Response {
  return streamSSE(c, async (stream) => {
    let closed = false;
    let inflight: Promise<void> | null = null;
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
          const state = await read();
          if (closed) return;
          const payload = JSON.stringify(state);
          if (payload === lastSent) return;
          lastSent = payload;
          await stream.writeSSE({ event: "state", data: payload });
          if (isTerminal?.(state)) closed = true;
        } catch (e) {
          console.error(
            `[auth-stream] read failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`,
          );
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

    const unsub = bus.subscribe(() => void send());
    stream.onAbort(() => {
      closed = true;
      unsub();
    });

    await send();

    const aborted = Promise.withResolvers<void>();
    stream.onAbort(aborted.resolve);
    while (!stream.aborted && !closed) {
      await Promise.race([stream.sleep(25_000), aborted.promise]);
      if (stream.aborted || closed) break;
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        break;
      }
    }
  });
}

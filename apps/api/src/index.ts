import type { Server as HttpServer } from "node:http";
import { serve } from "@hono/node-server";
import { app } from "./app.ts";
import { startOutreachWorker } from "./lib/outreach-worker.ts";
import { warmupMaxListeners } from "./lib/max-conversation.ts";
import { startMetricsWorker } from "./lib/metrics-worker.ts";
import { startBotPolling } from "./lib/tg-bot.ts";

const port = Number(process.env.PORT ?? 3000);

// Outbound-воркер крутится в том же Node-процессе что и HTTP-сервер. Это норм
// для single-instance dev (а у нас pre-prod). Для multi-instance: вынести в
// отдельный процесс с advisory-lock'ом или по sticky-routing на одну реплику,
// чтобы две реплики не выбирали одни и те же scheduled_messages.
if (process.env.NODE_ENV !== "test") {
  startOutreachWorker();
  // Persistent MAX-listener'ы (NOTIF_MESSAGE → отметка ответа лида). Поднимаем
  // сокеты active MAX-аккаунтов, как warmupListeners для TG. Periodic re-warmup:
  // пассивный listener (входящие не шлёт) не триггерит self-reconnect, поэтому
  // мёртвый сокет переподнимаем раз в 10 мин (connected — дешёвый cache-hit).
  void warmupMaxListeners();
  setInterval(() => void warmupMaxListeners(), 10 * 60_000);
  startMetricsWorker();
  // RU-сервер: webhook не доставляется (входящий к RU-IP таймаутит), тянем
  // апдеты сами long-polling'ом. setupWebhook оставлен в tg-bot.ts на случай
  // не-RU окружения, где webhook предпочтительнее.
  void startBotPolling().catch((e: unknown) =>
    console.error("[tg-bot] startBotPolling failed:", e),
  );
}

// serve() возвращает union Server | Http2Server; HTTP/2 не включаем, так что
// это всегда node:http Server — кастуем чтобы проставить timeouts.
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api: http://localhost:${info.port}`);
}) as HttpServer;

// Cold MTProto handshake / ExportLoginToken легко уходит за дефолтный
// headersTimeout (60s) — поднимаем. requestTimeout = 0 чтобы SSE long-polls
// (heartbeat 25s) не рвались по таймауту запроса.
server.headersTimeout = 120_000;
server.requestTimeout = 0;
server.keepAliveTimeout = 65_000;

import { app } from "./app";
import { startOutreachWorker } from "./lib/outreach-worker";

const port = Number(process.env.PORT ?? 3000);

console.log(`api: http://localhost:${port}`);

// Outbound-воркер крутится в том же Bun-процессе что и HTTP-сервер. Это норм
// для single-instance dev (а у нас pre-prod). Для multi-instance: вынести в
// отдельный процесс с advisory-lock'ом или по sticky-routing на одну реплику,
// чтобы две реплики не выбирали одни и те же scheduled_messages.
if (process.env.NODE_ENV !== "test") {
  startOutreachWorker();
}

export default {
  port,
  fetch: app.fetch,
  // Bun дефолт = 10s; мало для TG-роутов (cold MTProto handshake + ExportLoginToken
  // легко уходит за 10s). 60s — комфорт без риска повесить worker надолго.
  idleTimeout: 60,
};

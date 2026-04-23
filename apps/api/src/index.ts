import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);

console.log(`api: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Bun дефолт = 10s; мало для TG-роутов (cold MTProto handshake + ExportLoginToken
  // легко уходит за 10s). 60s — комфорт без риска повесить worker надолго.
  idleTimeout: 60,
};

import { app } from "./app";

const port = Number(process.env.PORT ?? 3000);

console.log(`api: http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

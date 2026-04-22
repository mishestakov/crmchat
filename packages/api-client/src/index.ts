import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths } from "./schema";

// credentials: "include" — чтобы session cookie летели и при cross-origin baseUrl
// (api.crmchat.ai из app.crmchat.ai). CORS настроен с credentials:true в apps/api/src/app.ts.
export const createApiClient = (baseUrl = "http://localhost:3000") =>
  createClient<paths>({ baseUrl, credentials: "include" });

import createClient from "openapi-fetch";
import type { paths } from "./schema";

export type { paths } from "./schema";

export const createApiClient = (baseUrl = "http://localhost:3000") =>
  createClient<paths>({ baseUrl });

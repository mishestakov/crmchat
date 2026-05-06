import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// Кэш на globalThis: защита от повторного импорта модуля в одном процессе
// (test-runner, experimental-loader) — постгрес-пул не пересоздаётся,
// max_connections не выедается. Под `node --watch-path=src` (full restart)
// этот сценарий не возникает, но кэш безвреден.
const g = globalThis as unknown as {
  __crmchatSql?: ReturnType<typeof postgres>;
};
export const sql = (g.__crmchatSql ??= postgres(url));
export const db = drizzle(sql);

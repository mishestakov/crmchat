import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

// Bun --hot переисполняет модуль на каждое сохранение, но НЕ закрывает старый
// postgres()-пул. Без globalThis-кэша после ~10 правок упираемся в
// max_connections (по дефолту 100) и БД начинает выдавать "too many clients".
// В prod (`bun build` + run) модуль исполняется один раз — `??=` сводится
// к обычному созданию пула.
const g = globalThis as unknown as {
  __crmchatSql?: ReturnType<typeof postgres>;
};
export const sql = (g.__crmchatSql ??= postgres(url));
export const db = drizzle(sql);

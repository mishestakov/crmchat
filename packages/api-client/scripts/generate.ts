import { writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

// Схема берётся ОФФЛАЙН из исходников API: импортируем app (apps/api/src/app.ts
// без сайд-эффектов — воркеры стартуют в index.ts) и дёргаем in-memory
// app.request("/openapi.json"). Ни запущенный сервер, ни БД не нужны:
// drizzle/postgres коннектятся лениво, DATABASE_URL подставляем заглушкой.
// Раньше генерация требовала живой localhost:3000 → схему обновляли только на
// деплой-хосте, локальная протухала и создавала baseline type-ошибок,
// ослеплявший typecheck. API_URL остаётся как override (генерация против
// живого инстанса, если вдруг понадобится).
const url = process.env.API_URL;
let schema: unknown;
if (url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openapi.json: HTTP ${res.status}`);
  schema = await res.json();
} else {
  process.env.DATABASE_URL ??=
    "postgres://offline:offline@localhost:5432/offline";
  // Контракт генерим ПОЛНЫЙ, включая dev-ручки (_dev/users, _dev/login):
  // фронт их типизирует (дев-свитчер юзера в _authenticated.tsx), а прод
  // прячет их рантайм-гейтом (auth.ts: NODE_ENV+ALLOW_DEV_AUTH), не типами.
  // Без этого схема зависела бы от env машины генерации.
  process.env.NODE_ENV = "development";
  process.env.ALLOW_DEV_AUTH = "true";
  const { app } = await import("../../../apps/api/src/app.ts");
  const res = await app.request("/openapi.json");
  if (!res.ok) throw new Error(`openapi.json: HTTP ${res.status}`);
  schema = await res.json();
}
const ast = await openapiTS(schema as Parameters<typeof openapiTS>[0]);
const code = astToString(ast);
await writeFile("src/schema.ts", code);
console.log(
  `generated src/schema.ts ${url ? `from ${url}` : "offline (apps/api sources)"}`,
);

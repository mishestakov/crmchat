import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { properties as propsTable } from "../db/schema";

// Валидирует body.properties контакта против определений в workspace.
// - неизвестный ключ → 400
// - значение неправильного типа → 400
// - single_select с id, которого нет в values → 400
// - null/"" → пропускаем (вызывающий handler решает: skip для POST, delete для PATCH).
//
// Возвращает объект только non-null значений, готовый к merge или replace.
export async function validateContactProperties(
  wsId: string,
  input: Record<string, unknown> | undefined | null,
): Promise<Record<string, unknown>> {
  if (!input) return {};
  const defs = await db
    .select()
    .from(propsTable)
    .where(eq(propsTable.workspaceId, wsId));
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (raw === null || raw === undefined || raw === "") continue;
    const def = defs.find((p) => p.key === key);
    if (!def) {
      throw new HTTPException(400, { message: `unknown property: ${key}` });
    }
    if (def.type === "text") {
      if (typeof raw !== "string") {
        throw new HTTPException(400, {
          message: `property "${key}" expects string`,
        });
      }
      out[key] = raw;
    } else if (def.type === "number") {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        throw new HTTPException(400, {
          message: `property "${key}" expects number`,
        });
      }
      out[key] = n;
    } else if (def.type === "single_select") {
      if (typeof raw !== "string") {
        throw new HTTPException(400, {
          message: `property "${key}" expects option id`,
        });
      }
      const ok = def.values?.some((v) => v.id === raw);
      if (!ok) {
        throw new HTTPException(400, {
          message: `property "${key}": unknown option "${raw}"`,
        });
      }
      out[key] = raw;
    }
  }
  return out;
}

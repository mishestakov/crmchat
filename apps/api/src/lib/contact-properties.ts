import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { properties as propsTable } from "../db/schema";

type PropertyDef = typeof propsTable.$inferSelect;

export async function loadPropertyDefs(wsId: string): Promise<PropertyDef[]> {
  return db.select().from(propsTable).where(eq(propsTable.workspaceId, wsId));
}

// Валидирует body.properties контакта против определений в workspace.
// - неизвестный ключ → 400
// - значение неправильного типа → 400
// - single_select с id, которого нет в values → 400
// - multi_select: каждое значение должно быть валидным option.id
// - null/""/[] → пропускаем (вызывающий handler решает: skip для POST, delete для PATCH).
export function validateContactProperties(
  defs: PropertyDef[],
  input: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  if (!input) return {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (
      raw === null ||
      raw === undefined ||
      raw === "" ||
      (Array.isArray(raw) && raw.length === 0)
    ) {
      continue;
    }
    const def = defs.find((p) => p.key === key);
    if (!def) {
      throw new HTTPException(400, { message: `unknown property: ${key}` });
    }
    out[key] = validateValue(def, raw);
  }
  return out;
}

function validateValue(def: PropertyDef, raw: unknown): unknown {
  const expectString = (label: string) => {
    if (typeof raw !== "string") {
      throw new HTTPException(400, {
        message: `property "${def.key}" expects ${label}`,
      });
    }
    return raw;
  };

  switch (def.type) {
    case "text":
    case "textarea":
    case "tel":
    case "user_select":
      return expectString("string");

    case "email": {
      const s = expectString("email string");
      // Лёгкая проверка — UI ставит type="email" и валидирует браузером;
      // здесь финальный страховочный rejection уродцев.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        throw new HTTPException(400, {
          message: `property "${def.key}": invalid email`,
        });
      }
      return s;
    }

    case "url": {
      const s = expectString("url string");
      try {
        new URL(s);
      } catch {
        throw new HTTPException(400, {
          message: `property "${def.key}": invalid url`,
        });
      }
      return s;
    }

    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        throw new HTTPException(400, {
          message: `property "${def.key}" expects number`,
        });
      }
      return raw;
    }

    case "single_select": {
      const s = expectString("option id");
      const ok = def.values?.some((v) => v.id === s);
      if (!ok) {
        throw new HTTPException(400, {
          message: `property "${def.key}": unknown option "${s}"`,
        });
      }
      return s;
    }

    case "multi_select": {
      if (!Array.isArray(raw)) {
        throw new HTTPException(400, {
          message: `property "${def.key}" expects array of option ids`,
        });
      }
      const allowed = new Set(def.values?.map((v) => v.id) ?? []);
      const cleaned: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string") {
          throw new HTTPException(400, {
            message: `property "${def.key}": each value must be string`,
          });
        }
        if (!allowed.has(item)) {
          throw new HTTPException(400, {
            message: `property "${def.key}": unknown option "${item}"`,
          });
        }
        cleaned.push(item);
      }
      return Array.from(new Set(cleaned));
    }

    default: {
      // exhaustiveness: добавил новый PropertyType — TS зажжёт здесь, и без явного
      // case значение не пройдёт молча через валидатор.
      const _exhaustive: never = def.type;
      throw new HTTPException(500, {
        message: `unhandled property type: ${String(_exhaustive)}`,
      });
    }
  }
}

// Проверяет, что для всех required-properties значение задано (не пусто) в финальном
// объекте контакта (после merge для PATCH или прямо input для POST).
export function enforceRequiredProperties(
  defs: PropertyDef[],
  finalProps: Record<string, unknown>,
): void {
  for (const def of defs) {
    if (!def.required) continue;
    const v = finalProps[def.key];
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (empty) {
      throw new HTTPException(400, {
        message: `property "${def.name}" is required`,
      });
    }
  }
}

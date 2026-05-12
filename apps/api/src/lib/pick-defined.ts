// Берёт только те ключи из body, которые !== undefined. Нужно при PATCH-роутах
// со Zod .optional() — undefined-поля не должны попадать в UPDATE .set(),
// иначе drizzle перезатрёт колонку null'ом (или в случае zod.optional() —
// просто шумит в SQL).
export function pickDefined<T extends Record<string, unknown>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

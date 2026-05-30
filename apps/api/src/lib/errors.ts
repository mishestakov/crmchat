// TDLib через tdl кидает Error с message формата `<code>: <message>`
// (например "400: PHONE_CODE_INVALID"), прочие источники — строкой.
// Универсальный extractor под match'инг по содержимому.
export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

// Postgres unique_violation (23505). ВАЖНО: Drizzle-билдер (db.insert/update)
// оборачивает ошибку в DrizzleQueryError, и PG-код лежит на `cause.code`, а не
// на `code` (на `code` он только у сырого sml-клиента postgres.js). Проверяем оба,
// чтобы детект работал независимо от того, как создан запрос.
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

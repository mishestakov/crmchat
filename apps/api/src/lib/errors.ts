// TDLib через tdl кидает Error с message формата `<code>: <message>`
// (например "400: PHONE_CODE_INVALID"), прочие источники — строкой.
// Универсальный extractor под match'инг по содержимому.
export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

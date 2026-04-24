// gramjs кидает Error с понятным `.message` (типа "PHONE_CODE_INVALID"); прочее
// бросает строкой. Универсальный extractor под match'инг по содержимому.
export function errMsg(e: unknown): string {
  return String((e as Error)?.message ?? e);
}

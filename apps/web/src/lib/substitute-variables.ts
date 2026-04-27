// Frontend-копия server'ной substituteVariables (apps/api/src/lib/substitute-variables.ts).
// Используется в preview-диалоге сообщения sequence — показать «как будет выглядеть
// текст для конкретного лида» до активации. На сервере подстановка происходит
// один раз при активации (snapshot в scheduled_messages.text), здесь — только
// для UI. Если ключ не нашёлся — оставляем placeholder как есть.

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function substituteVariables(
  text: string,
  lead: {
    username: string | null;
    phone: string | null;
    properties: Record<string, string>;
  },
): string {
  return text.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (key in lead.properties) return lead.properties[key] ?? match;
    if (key === "username" && lead.username) return lead.username;
    if (key === "phone" && lead.phone) return lead.phone;
    return match;
  });
}

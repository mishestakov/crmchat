// Раскрывает {{key}} в тексте по полям лида. Lookup:
//   1) lead.properties[key] (CRM-property keys + raw CSV header keys)
//   2) canonical scalar поле: username
//   3) отправитель — имя отправляющего аккаунта (передаётся отдельно, не из лида)
// Если ключ не нашёлся — оставляем placeholder как есть, чтобы юзер увидел в
// preview/scheduled.text пропущенную переменную, а не «пусто». Whitespace внутри
// {{ key }} игнорируется.
//
// Подстановка делается ОДИН РАЗ при активации sequence (snapshot в
// scheduled_messages.text). Поэтому интенсивные оптимизации тут не нужны.

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function substituteVariables(
  text: string,
  lead: {
    username: string | null;
    properties: Record<string, string>;
    // Имя ОТПРАВЛЯЮЩЕГО аккаунта (outreach_name ?? first_name) для {{отправитель}}.
    // Аккаунт-уровень, а не lead-property: резолвится в buildScheduledRows по
    // выбранному для лида аккаунту, чтобы Серёжа не подписался Юлей.
    senderName?: string | null;
  },
): string {
  return text.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
    const key = rawKey.trim();
    if (key in lead.properties) return lead.properties[key] ?? match;
    if (key === "username" && lead.username) return lead.username;
    if (key === "отправитель" && lead.senderName) return lead.senderName;
    return match;
  });
}

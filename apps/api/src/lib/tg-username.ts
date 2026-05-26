// Нормализация Telegram-@username из произвольного ввода: «https://t.me/durov»,
// «@durov», «durov/123», «www.t.me/durov» → lower-case «durov». Приватные
// инвайты (t.me/+xxx, joinchat) username не имеют → null. Невалидный формат
// (точки, пробелы, слишком коротко) → null. Общий util: используется и в
// массовом добавлении каналов, и в привязке админов по username.
export function extractUsername(raw: string): string | null {
  let s = raw.trim().replace(/^https?:\/\//i, "");
  s = s.replace(/^www\./i, "");
  s = s.replace(/^(t\.me\/|telegram\.me\/)/i, "");
  s = s.replace(/^@/, "");
  if (s.startsWith("+") || s.toLowerCase().startsWith("joinchat/")) return null;
  s = (s.split(/[/?\s]/)[0] ?? "").toLowerCase();
  return /^[a-z0-9_]{2,64}$/.test(s) ? s : null;
}

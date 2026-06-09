// Парсер «адреса TG-канала» из произвольной строки. Принимаем: @-форму,
// голый username, t.me/foo, t.me/+abc, t.me/joinchat/abc, tg://resolve.
//
// Правила username — точная копия TDLib `is_allowed_username`
// (td/telegram/misc.cpp:260 + LinkManager.cpp:89): 5-32 символа,
// начинается с буквы, [a-zA-Z0-9_], не заканчивается на `_`. Проверку
// «нет `__`» опускаем как edge-case — TDLib сам отсеет на subscribe.
//
// ЕДИНСТВЕННЫЙ валидатор @username в кодовой базе: bulk-добавление каналов,
// привязка админов и set-admin резолвят имя только через эту функцию (бывший
// extractUsername с расходящимся правилом 2-64 удалён). Нужен только username
// без invite — бери `parseChannelInput(x).username`.
//
// Возвращает один из двух слотов: `username` (→ searchPublicChat) или
// `inviteLink` (→ joinChatByInviteLink). Каноническая форма invite —
// `https://t.me/+<hash>`, старый /joinchat/<hash> нормализуется к
// новому виду для дедупа по `eq(channels.link)` в БД.

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,30}[a-zA-Z0-9]$/;

export type ParsedChannelInput = {
  username: string | null;
  inviteLink: string | null;
};

export function parseChannelInput(
  raw: string | undefined | null,
): ParsedChannelInput {
  const empty: ParsedChannelInput = { username: null, inviteLink: null };
  if (!raw) return empty;
  let s = raw.trim();
  if (!s) return empty;

  s = s.replace(/^https?:\/\//i, "").replace(/^tg:\/\//i, "");

  // tg://resolve?domain=foo
  const tgResolve = s.match(/^resolve\?(?:.*&)?domain=([a-zA-Z0-9_]+)/i);
  if (tgResolve) {
    const u = tgResolve[1]!.toLowerCase();
    return USERNAME_RE.test(u) ? { username: u, inviteLink: null } : empty;
  }

  // t.me/...
  const tme = s.match(/^t\.me\/(.+)$/i);
  if (tme) {
    const tail = tme[1]!;
    const inviteNew = tail.match(/^\+([A-Za-z0-9_-]+)/);
    if (inviteNew) {
      return { username: null, inviteLink: `https://t.me/+${inviteNew[1]}` };
    }
    const inviteOld = tail.match(/^joinchat\/([A-Za-z0-9_-]+)/);
    if (inviteOld) {
      return { username: null, inviteLink: `https://t.me/+${inviteOld[1]}` };
    }
    // Хвост типа /123 (message_id), ?start=abc, #anchor — игнорим.
    const first = tail.split(/[/?#]/)[0]!.toLowerCase();
    return USERNAME_RE.test(first)
      ? { username: first, inviteLink: null }
      : empty;
  }

  // @username или голый username.
  const u = s.replace(/^@/, "").toLowerCase();
  return USERNAME_RE.test(u) ? { username: u, inviteLink: null } : empty;
}

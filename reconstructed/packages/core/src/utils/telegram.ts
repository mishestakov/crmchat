const TELEGRAM_MENTION_REGEX = /^@([a-zA-Z0-9_]+)$/;
const TELEGRAM_URL_REGEX = /^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]+)$/;
const VALID_TELEGRAM_USERNAME_REGEX = /^[a-zA-Z0-9_]{5,}$/;

export function parseTelegramUsername(
  username: string,
  options: {
    allowRawUsername?: boolean;
  }
) {
  const trimmedUsername = username.trim();

  const mentionMatch = trimmedUsername.match(TELEGRAM_MENTION_REGEX);
  if (mentionMatch && isValidTelegramUsername(mentionMatch[1] ?? "")) {
    return mentionMatch[1] ?? null;
  }

  const tmeMatch = trimmedUsername.match(TELEGRAM_URL_REGEX);
  if (tmeMatch && isValidTelegramUsername(tmeMatch[1] ?? "")) {
    return tmeMatch[1] ?? null;
  }

  if (options.allowRawUsername && isValidTelegramUsername(trimmedUsername)) {
    return trimmedUsername;
  }

  return null;
}

export function isValidTelegramUsername(username: string) {
  return VALID_TELEGRAM_USERNAME_REGEX.test(username);
}

export function normalizeTelegramUsername(username: string) {
  return username
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^(?:https?:\/\/)?t\.me\/([a-zA-Z0-9_]{5,})\??.*$/, "$1")
    .replace(/^(?:https?:\/\/)?([a-zA-Z0-9_]{5,})\.t\.me\/?.*$/, "$1");
}

export function formatUsername(username?: string | null) {
  if (!username) {
    return undefined;
  }
  return `@${username}`;
}

import { randomBytes } from "node:crypto";

// Только для dev: split origin между api (ngrok) и фронтом (localhost). В prod удалить.

const store = new Map<string, string>();
const TTL_MS = 60_000;

export function issueBridgeToken(userId: string): string {
  const token = randomBytes(24).toString("base64url");
  store.set(token, userId);
  setTimeout(() => store.delete(token), TTL_MS).unref();
  return token;
}

export function consumeBridgeToken(token: string): string | null {
  const userId = store.get(token) ?? null;
  store.delete(token);
  return userId;
}

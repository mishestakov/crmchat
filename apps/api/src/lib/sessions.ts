import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { sessions } from "../db/schema";

const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

// TODO(cleanup): добавить pg-boss schedule `cleanup.expired_sessions`
// (DELETE FROM sessions WHERE expires_at < now()) — таблица иначе растёт
// бесконечно. Безопасности это не вредит (requireSession фильтрует по
// expires_at), только raw size.

function newSessionId(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

export async function createSession(
  c: Context,
  userId: string,
): Promise<string> {
  // Ротация: если юзер уже залогинен (dev-switcher или повторный OAuth-callback),
  // удаляем предыдущую sessions-row, чтобы cookie на неё не указывала и не
  // оставалось висячих row'ов до expires_at.
  const oldSid = getCookie(c, "sid");
  if (oldSid) {
    await db.delete(sessions).where(eq(sessions.id, oldSid));
  }
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_SEC * 1000);
  await db.insert(sessions).values({ id, userId, expiresAt });
  setCookie(c, "sid", id, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SEC,
  });
  return id;
}

export async function destroySession(c: Context, id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
  deleteCookie(c, "sid", { path: "/" });
}

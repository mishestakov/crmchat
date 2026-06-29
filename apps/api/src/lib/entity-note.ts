import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import type { EntityNote } from "@repo/core";
import { users } from "../db/schema.ts";

// Имя юзера для денормализованного автора записи (byName на момент записи —
// без join'ов при чтении; смена имени задним числом запись не переписывает).
// Общий для памяток (EntityNote) и истории взаимодействия по каналу.
export async function lookupUserName(userId: string): Promise<string | null> {
  const [u] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.name ?? null;
}

// Собрать памятку от имени юзера.
export async function buildEntityNote(
  userId: string,
  text: string | null | undefined,
): Promise<EntityNote | null> {
  const t = text?.trim();
  if (!t) return null;
  return {
    text: t,
    byUserId: userId,
    byName: await lookupUserName(userId),
    at: new Date().toISOString(),
  };
}

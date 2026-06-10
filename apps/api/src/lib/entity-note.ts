import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import type { EntityNote } from "@repo/core";
import { users } from "../db/schema.ts";

// Собрать памятку от имени юзера: имя денормализуем на момент записи (без
// join'ов при чтении; смена имени задним числом памятку не переписывает).
export async function buildEntityNote(
  userId: string,
  text: string | null | undefined,
): Promise<EntityNote | null> {
  const t = text?.trim();
  if (!t) return null;
  const [u] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    text: t,
    byUserId: userId,
    byName: u?.name ?? null,
    at: new Date().toISOString(),
  };
}

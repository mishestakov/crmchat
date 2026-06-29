import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { channels } from "../db/schema.ts";
import { lookupUserName } from "./entity-note.ts";
import type { ChannelRelationEntry, ChannelRelationStatus } from "@repo/core";

// Записать смену статуса взаимодействия по каналу: append в relationHistory
// (append-only лог) + обновить relationStatus (снимок текущего, для быстрого
// чтения/фильтра). byName денормализуем на момент записи (как в EntityNote) —
// смена имени задним числом историю не переписывает. Запись может не менять
// статус (просто комментарий-наблюдение) — тогда status повторяет текущий.
// Append делаем атомарно в SQL (`||`), без read-modify-write: и дешевле (нет
// лишнего SELECT всей истории), и без гонки снимка с логом. Возвращает
// обновлённый ряд канала для сериализации без повторного чтения.
export async function recordChannelRelation(
  channelId: string,
  status: ChannelRelationStatus,
  note: string | null,
  userId: string,
): Promise<typeof channels.$inferSelect | undefined> {
  const entry: ChannelRelationEntry = {
    status,
    note: note?.trim() || null,
    byUserId: userId,
    byName: await lookupUserName(userId),
    at: new Date().toISOString(),
  };
  const [updated] = await db
    .update(channels)
    .set({
      relationStatus: status,
      relationHistory: sql`${channels.relationHistory} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channelId))
    .returning();
  return updated;
}

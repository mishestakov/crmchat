import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { channels } from "../db/schema.ts";

// Каналы — общая база воркспейса, видна всем member'ам. Write на канал
// (привязать/отвязать админа, sync, history) тоже всем — это пополнение
// центра истины. Create/Update/Delete самого канала — admin-only через
// assertRole в роутах.

export function channelAccessClause(workspaceId: string) {
  return eq(channels.workspaceId, workspaceId);
}

export async function assertChannelAccess(
  channelId: string,
  workspaceId: string,
): Promise<typeof channels.$inferSelect> {
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.workspaceId, workspaceId)))
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "channel not found" });
  }
  return row;
}

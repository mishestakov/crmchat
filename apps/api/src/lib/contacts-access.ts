import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { contacts } from "../db/schema.ts";

// Контакты — общая база воркспейса, видна всем member'ам. Write-операции
// (PATCH/POST /read/chat-history/chat-close/activities) тоже доступны
// member'у: контакт — общий ресурс, дополнить инфу/закрыть чат может любой.
// DELETE — admin-only через assertRole, ключевые контакты случайно не теряем.

export function contactAccessClause(workspaceId: string) {
  return eq(contacts.workspaceId, workspaceId);
}

export async function assertContactAccess(
  contactId: string,
  workspaceId: string,
): Promise<typeof contacts.$inferSelect> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)))
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "contact not found" });
  }
  return row;
}

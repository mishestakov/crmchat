import { and, eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { channels } from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";
import { myAccountIdsSql } from "./outreach-access.ts";

// Доступ к каналу:
//   admin  — все каналы workspace'а.
//   member — есть хотя бы один админ-контакт, доступный мне (sticky на мой
//            аккаунт ИЛИ DM через мой аккаунт). Логика контакт-доступа
//            здесь inline'ится, чтобы не делать второй EXISTS поверх
//            contactAccessClause (тот корреллирует с FROM contacts).
//
// Канал без админов (импорт CSV без admin_username, channel-row пока
// одиночка) member'у невидим — никто из его контактов с ним не связан.

export function channelAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(channels.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  const myAccounts = myAccountIdsSql(workspaceId, userId);
  return and(
    wsClause,
    sql`EXISTS (
      SELECT 1 FROM channel_admins ca
      JOIN contacts c ON c.id = ca.contact_id
      WHERE ca.channel_id = ${channels.id}
        AND (
          c.primary_account_id IN ${myAccounts}
          OR EXISTS (
            SELECT 1 FROM tg_chats tc
            WHERE tc.peer_user_id = (c.properties ->> 'tg_user_id')
              AND (c.properties ->> 'tg_user_id') IS NOT NULL
              AND tc.account_id IN ${myAccounts}
          )
        )
    )`,
  )!;
}

export async function assertChannelAccess(
  channelId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof channels.$inferSelect> {
  const [row] = await db
    .select()
    .from(channels)
    .where(
      and(eq(channels.id, channelId), channelAccessClause(workspaceId, userId, role)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "channel not found" });
  }
  return row;
}

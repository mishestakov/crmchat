import { and, eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { contacts } from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";
import { myAccountIdsSql } from "./outreach-access.ts";

// Доступ к контакту:
//   admin  — все контакты workspace'а.
//   member — sticky на мой аккаунт (primary_account_id ∈ мои) ИЛИ
//            был DM через мой аккаунт (tg_chats где peer = tg_user_id и
//            account ∈ мои). Второе ловит контакты, у которых sticky
//            закрепился за коллегой, но я тоже когда-то с ним общался —
//            считаем, что в курсе.
//
// Контакт без tg_user_id (stub-админ из CSV-импорта каналов) и без sticky
// для member'ов невидим — это OK: продуктово такой stub видит только тот
// member, кто работает с каналом, и его придёт через channel-access (где
// канал доступен другим путём, например по другому админу).

export function contactAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(contacts.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  const myAccounts = myAccountIdsSql(workspaceId, userId);
  return and(
    wsClause,
    sql`(
      ${contacts.primaryAccountId} IN ${myAccounts}
      OR EXISTS (
        SELECT 1 FROM tg_chats tc
        WHERE tc.peer_user_id = (${contacts.properties} ->> 'tg_user_id')
          AND (${contacts.properties} ->> 'tg_user_id') IS NOT NULL
          AND tc.account_id IN ${myAccounts}
      )
    )`,
  )!;
}

// Проверка доступа к конкретному контакту. 404 если нет (одинаково для
// «не существует» и «не доступен» — чтобы member не разведывал чужие id).
// Возвращает row (раз SELECT всё равно нужен).
export async function assertContactAccess(
  contactId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof contacts.$inferSelect> {
  const [row] = await db
    .select()
    .from(contacts)
    .where(
      and(eq(contacts.id, contactId), contactAccessClause(workspaceId, userId, role)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "contact not found" });
  }
  return row;
}

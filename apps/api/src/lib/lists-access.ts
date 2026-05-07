import { and, eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { outreachLists } from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";
import { myAccountIdsSql } from "./outreach-access.ts";

// Доступ к outreach-листу: admin видит все; member видит лист, если есть
// видимая ему задача на этот лист (через его аккаунт). Inline-копия
// sequenceAccessClause с алиасом seq — у нас correlated subquery, общий
// helper потребовал бы передавать column-refs, что не делает короче.

export function listAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(outreachLists.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  const myAccounts = myAccountIdsSql(workspaceId, userId);
  return and(
    wsClause,
    sql`EXISTS (
      SELECT 1 FROM outreach_sequences seq
      WHERE seq.list_id = ${outreachLists.id}
        AND seq.workspace_id = ${workspaceId}
        AND (
          (seq.accounts_mode = 'selected'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(seq.accounts_selected) sel(id)
              WHERE sel.id IN ${myAccounts}
            ))
          OR (seq.accounts_mode = 'all'
            AND EXISTS (SELECT 1 FROM ${myAccounts} mine))
        )
    )`,
  )!;
}

export async function assertListAccess(
  listId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof outreachLists.$inferSelect> {
  const [row] = await db
    .select()
    .from(outreachLists)
    .where(
      and(eq(outreachLists.id, listId), listAccessClause(workspaceId, userId, role)),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "list not found" });
  }
  return row;
}

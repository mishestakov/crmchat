import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import {
  outreachAccountDelegations,
  outreachAccounts,
} from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";

// Доступ к outreach-аккаунту:
//   admin  — все аккаунты workspace'а.
//   member — owner=self ИЛИ активная делегация (now ∈ [starts_at, ends_at)).
// Делегация без ends_at — бессрочная.

const activeDelegationExists = (userId: string): SQL =>
  sql`EXISTS (
    SELECT 1 FROM ${outreachAccountDelegations} d
    WHERE d.account_id = ${outreachAccounts.id}
      AND d.delegate_id = ${userId}
      AND now() >= d.starts_at
      AND (d.ends_at IS NULL OR now() < d.ends_at)
  )`;

// Subquery «мои аккаунты» — self-contained (не корреллирует с outer'ом),
// в отличие от accountAccessClause. Используется в каскадных RBAC-чеках.
export const myAccountIdsSql = (workspaceId: string, userId: string): SQL =>
  sql`(
    SELECT oa.id FROM outreach_accounts oa
    WHERE oa.workspace_id = ${workspaceId}
      AND (
        oa.owner_user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM outreach_account_delegations d
          WHERE d.account_id = oa.id
            AND d.delegate_id = ${userId}
            AND now() >= d.starts_at
            AND (d.ends_at IS NULL OR now() < d.ends_at)
        )
      )
  )`;

// Drizzle WHERE-фрагмент для list-запросов. Использовать как
// `.where(accountAccessClause(wsId, userId, role))` — уже включает фильтр
// по workspace_id.
export function accountAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(outreachAccounts.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  return and(
    wsClause,
    or(eq(outreachAccounts.ownerUserId, userId), activeDelegationExists(userId)),
  )!;
}

// Проверка доступа к конкретному аккаунту. Бросает 404 если нет (одинаково
// для «не существует» и «не доступен» — чтобы member не мог разведать
// существование чужих аккаунтов). Возвращает row (раз уж SELECT всё равно нужен).
export async function assertAccountAccess(
  accountId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof outreachAccounts.$inferSelect> {
  const [row] = await db
    .select()
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        accountAccessClause(workspaceId, userId, role),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "account not found" });
  }
  return row;
}

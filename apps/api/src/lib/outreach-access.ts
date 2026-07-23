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

// Subquery «все аккаунты workspace'а» — для сигналов уровня команды («кто-либо
// из воркспейса общался»), в отличие от myAccountIdsSql (только мои +
// делегированные). Совпадает со скоупом joinAdmins (channels.ts): сигнал «уже
// общались» должен видеть переписку любого аккаунта команды, а не только
// смотрящего.
export const workspaceAccountIdsSql = (workspaceId: string): SQL =>
  sql`(SELECT oa.id FROM outreach_accounts oa WHERE oa.workspace_id = ${workspaceId})`;

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
// СЛАБЫЙ чек «аккаунт принадлежит воркспейсу» — БЕЗ owner/делегации. Только
// для документированного read-исключения (specs/permissions.md §3): просмотр
// переписки коллеги — chat-history и обслуживающие просмотр медиа/файлы/
// mark-флаги. Любое ДЕЙСТВИЕ от имени аккаунта (send/edit/delete/bot-start/
// sticky/share-link) обязано идти через assertAccountAccess ниже — иначе
// member действует через чужой неделегированный аккаунт, зная его id из UI.
export async function assertAccountInWorkspace(
  accountId: string,
  workspaceId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "account not found" });
}

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

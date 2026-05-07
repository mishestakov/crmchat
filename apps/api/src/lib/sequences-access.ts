import { and, eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { outreachSequences } from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";
import { myAccountIdsSql } from "./outreach-access.ts";

// Доступ к outreach-задаче (sequence):
//   admin  — все задачи workspace'а.
//   member —
//     - accountsMode='selected' AND accountsSelected пересекается с моими
//       аккаунтами (?| в jsonb), либо
//     - accountsMode='all' AND у меня есть хотя бы один аккаунт в WS
//       (раз задача общая на все, мой аккаунт точно среди отправляющих).
//
// Активацию/паузу/правку всё равно делает admin (assertRole в роутах);
// member видит задачу — чтобы понимать что с его аккаунтом происходит и
// видеть прогресс по своим лидам.

export function sequenceAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(outreachSequences.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  const myAccounts = myAccountIdsSql(workspaceId, userId);
  return and(
    wsClause,
    sql`(
      (${outreachSequences.accountsMode} = 'selected'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${outreachSequences.accountsSelected}) sel(id)
          WHERE sel.id IN ${myAccounts}
        ))
      OR (${outreachSequences.accountsMode} = 'all'
        AND EXISTS (SELECT 1 FROM ${myAccounts} mine))
    )`,
  )!;
}

export async function assertSequenceAccess(
  sequenceId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof outreachSequences.$inferSelect> {
  const [row] = await db
    .select()
    .from(outreachSequences)
    .where(
      and(
        eq(outreachSequences.id, sequenceId),
        sequenceAccessClause(workspaceId, userId, role),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "sequence not found" });
  }
  return row;
}

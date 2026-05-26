import { and, eq, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { projects } from "../db/schema.ts";
import type { WorkspaceRole } from "../middleware/assert-member.ts";
import { myAccountIdsSql } from "./outreach-access.ts";

// Доступ к проекту:
//   admin  — все проекты workspace'а.
//   member —
//     - accountsMode='selected' AND accountsSelected пересекается с моими
//       аккаунтами (?| в jsonb), либо
//     - accountsMode='all' AND у меня есть хотя бы один аккаунт в WS
//       (раз проект общий на все, мой аккаунт точно среди отправляющих).
//
// Активацию/паузу/правку всё равно делает admin (assertRole в роутах);
// member видит проект — чтобы понимать что с его аккаунтом происходит и
// видеть прогресс по своим лидам.

export function projectAccessClause(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): SQL {
  const wsClause = eq(projects.workspaceId, workspaceId);
  if (role === "admin") return wsClause;
  const myAccounts = myAccountIdsSql(workspaceId, userId);
  // agency-проекты (kind='agency') видны всем member'ам ws — это общий ресурс
  // агентства (как контакты/каналы), доступ не привязан к outreach-аккаунтам.
  // Без этого member без подключённого аккаунта залочен во всей agency-фиче
  // (пустое дерево кампаний + 404 на всех endpoint'ах). Owner-based RBAC
  // (спека §7, видимость по ответственному менеджеру) — отдельный шаг.
  return and(
    wsClause,
    sql`(
      ${projects.kind} = 'agency'
      OR (${projects.accountsMode} = 'selected'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${projects.accountsSelected}) sel(id)
          WHERE sel.id IN ${myAccounts}
        ))
      OR (${projects.accountsMode} = 'all'
        AND EXISTS (SELECT 1 FROM ${myAccounts} mine))
    )`,
  )!;
}

export async function assertProjectAccess(
  projectId: string,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<typeof projects.$inferSelect> {
  const [row] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        projectAccessClause(workspaceId, userId, role),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "project not found" });
  }
  return row;
}

import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaces } from "../db/schema";
import type { SessionVars } from "./require-session";

export type WorkspaceVars = SessionVars & { workspaceId: string };

// Гарант workspace-tenancy: handler гарантированно работает только с workspace,
// к которому у user'а есть доступ. Сейчас правило — `workspaces.createdBy = userId`;
// при добавлении workspace_members заменится на membership-join.
//
// ПОИСК: то же правило `createdBy = userId` дублируется в:
//   - apps/api/src/routes/workspaces.ts (PATCH /v1/workspaces/:id — путь не под этим middleware)
//   - apps/api/src/routes/workspaces.ts (GET/POST /v1/workspaces — фильтр списка)
// При переходе на workspace_members поменять во всех трёх местах синхронно.
//
// TODO: per-request DB-roundtrip. Под нагрузкой добавить in-memory кэш
// (userId, wsId) → role с TTL ~30s. Или вообще убрать middleware и врезать
// `where workspace_id = ? AND ...member-check...` в каждый основной запрос.
export const assertMember: MiddlewareHandler<{ Variables: WorkspaceVars }> =
  async (c, next) => {
    const userId = c.get("userId");
    const wsId = c.req.param("wsId");
    if (!wsId) throw new HTTPException(400, { message: "wsId required" });
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, wsId), eq(workspaces.createdBy, userId)))
      .limit(1);
    if (!row) throw new HTTPException(403, { message: "not a member" });
    c.set("workspaceId", wsId);
    await next();
  };

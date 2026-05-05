import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { workspaceMembers } from "../db/schema";
import type { SessionVars } from "./require-session";

export type WorkspaceRole = "admin" | "member";

export type WorkspaceVars = SessionVars & {
  workspaceId: string;
  workspaceRole: WorkspaceRole;
};

// Гарант workspace-tenancy: handler гарантированно работает только с workspace,
// в котором у user'а есть row в `workspace_members`. Кладёт role в контекст —
// дальше handler'ы используют её через `assertRole` или явный c.get("workspaceRole").
//
// 403 одинаково для «не существует» и «не ваш» — намеренно, чтобы не раскрывать
// существование чужих wsId (см. DECISIONS.md «Известный технический долг»).
//
// TODO: per-request DB-roundtrip. Под нагрузкой добавить in-memory кэш
// (userId, wsId) → role с TTL ~30s.
export const assertMember: MiddlewareHandler<{ Variables: WorkspaceVars }> =
  async (c, next) => {
    const userId = c.get("userId");
    const wsId = c.req.param("wsId");
    if (!wsId) throw new HTTPException(400, { message: "wsId required" });
    const [row] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(403, { message: "not a member" });
    c.set("workspaceId", wsId);
    c.set("workspaceRole", row.role as WorkspaceRole);
    await next();
  };

// Поверх `assertMember`. Бросает 403, если у юзера роль ниже требуемой.
// Сейчас `admin` — единственная роль выше `member`; если появятся уровни,
// поменять на сравнение по rank'у.
export function assertRole(required: WorkspaceRole): MiddlewareHandler<{
  Variables: WorkspaceVars;
}> {
  return async (c, next) => {
    const role = c.get("workspaceRole");
    if (required === "admin" && role !== "admin") {
      throw new HTTPException(403, { message: "admin role required" });
    }
    await next();
  };
}

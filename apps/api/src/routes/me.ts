import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users, workspaceMembers } from "../db/schema.ts";
import type { SessionVars } from "../middleware/require-session.ts";

const Me = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().nullable(),
    username: z.string().nullable(),
    // True если юзер — admin хотя бы в одном workspace. Фронту нужен для
    // условного рендера admin-фич в pre-ws-layout (DevUserSwitcher и т.п.),
    // где ещё нет активного wsId. Для per-ws gates используется role из
    // workspace context, не этот флаг.
    hasAdminRole: z.boolean(),
    // Логин в корп-CRM Яндекса — им подписывается владелец тикета при
    // квалификации. Пустой = вердикт вынести нельзя (тикет без владельца
    // бесполезен для их отчётности). Справочника сотрудников в API CRM нет,
    // поэтому просто строка, которую менеджер указывает про себя.
    crmLogin: z.string().nullable(),
  })
  .openapi("Me");

const UpdateMe = z
  .object({ crmLogin: z.string().max(64).nullable() })
  .openapi("UpdateMe");

const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/auth/me",
    tags: ["auth"],
    responses: {
      200: {
        content: { "application/json": { schema: Me } },
        description: "Current user",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const [u] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        crmLogin: users.crmLogin,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) throw new HTTPException(401, { message: "user vanished" });
    const [adminRow] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.role, "admin"),
        ),
      )
      .limit(1);
    return c.json({ ...u, hasAdminRole: adminRow !== undefined });
  },
);

// Свой CRM-логин менеджер задаёт сам. Не валидируем: справочника сотрудников в
// API CRM нет (`manager/bylogin` отдаёт 403), а опечатка всплывёт сразу — на
// первом же вердикте CRM откажется ставить владельца, и текст ошибки ляжет
// на карточку лида.
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/auth/me",
    tags: ["auth"],
    request: {
      body: {
        content: { "application/json": { schema: UpdateMe } },
        required: true,
      },
    },
    responses: { 204: { description: "Saved" } },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { crmLogin } = c.req.valid("json");
    const trimmed = crmLogin?.trim();
    await db
      .update(users)
      .set({ crmLogin: trimmed ? trimmed : null, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return c.body(null, 204);
  },
);

export default app;

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import {
  WorkspaceSchema as BaseWorkspaceSchema,
  CreateWorkspaceSchema as BaseCreateWorkspaceSchema,
  UpdateWorkspaceSchema as BaseUpdateWorkspaceSchema,
} from "@repo/core";
import { db } from "../db/client";
import {
  users,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import { seedDefaultProperties } from "../lib/workspace-presets";
import type { SessionVars } from "../middleware/require-session";

const WorkspaceSchema = BaseWorkspaceSchema.openapi("Workspace");
const CreateWorkspaceSchema = BaseCreateWorkspaceSchema.openapi("CreateWorkspace");
const UpdateWorkspaceSchema = BaseUpdateWorkspaceSchema.openapi("UpdateWorkspace");

const IdParam = z.object({ id: z.string().min(1).max(64) });

const app = new OpenAPIHono<{ Variables: SessionVars }>();

const listRoute = createRoute({
  method: "get",
  path: "/v1/workspaces",
  responses: {
    200: {
      content: { "application/json": { schema: z.array(WorkspaceSchema) } },
      description: "All workspaces",
    },
  },
});

app.openapi(listRoute, async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdBy: workspaces.createdBy,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      eq(workspaceMembers.workspaceId, workspaces.id),
    )
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
  return c.json(rows.map(serialize));
});

const createRouteDef = createRoute({
  method: "post",
  path: "/v1/workspaces",
  request: {
    body: {
      content: { "application/json": { schema: CreateWorkspaceSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: WorkspaceSchema } },
      description: "Created",
    },
  },
});

app.openapi(createRouteDef, async (c) => {
  const userId = c.get("userId");
  const { name } = c.req.valid("json");
  const row = await db.transaction(async (tx) => {
    const [ws] = await tx
      .insert(workspaces)
      .values({ name, createdBy: userId })
      .returning();
    // Создатель — admin. Это единственная точка автогенерации admin'а; все
    // остальные admin'ы появляются через ручную смену роли (US-4) или через
    // принятие инвайта с role='admin' (US-3).
    await tx.insert(workspaceMembers).values({
      workspaceId: ws!.id,
      userId,
      role: "admin",
    });
    return ws!;
  });
  // 8 preset-properties (full_name, description, email, phone, telegram_username,
  // url, amount, stage). Делаем всегда — без них контакты невозможно создать,
  // и UI ожидает их как identity-секцию карточки.
  await seedDefaultProperties(row.id);
  return c.json(serialize(row), 201);
});

// PATCH /v1/workspaces/:id — путь не матчится assertMember (тот ждёт /:wsId/*),
// поэтому проверяем доступ + роль вручную через workspace_members. Только admin
// может переименовывать ws (см. specs/permissions.md §2).
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{id}",
    request: {
      params: IdParam,
      body: {
        content: { "application/json": { schema: UpdateWorkspaceSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: WorkspaceSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const [member] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) {
      // 404 для consistency с assertMember (не различаем "не существует" / "не ваш")
      throw new HTTPException(404, { message: "workspace not found" });
    }
    if (member.role !== "admin") {
      throw new HTTPException(403, { message: "admin role required" });
    }
    const [row] = await db
      .update(workspaces)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(workspaces.id, id))
      .returning();
    if (!row) {
      throw new HTTPException(404, { message: "workspace not found" });
    }
    return c.json(serialize(row));
  },
);

// DELETE /v1/workspaces/:id — admin only. Каскадно сносит всё (контакты,
// аккаунты, кампании, members, invites — через ON DELETE CASCADE на
// workspace_id во всех доменных таблицах). Это единственный способ
// «избавиться от ws»: leave-self последним admin'ом отдаёт 409. См.
// DECISIONS.md «Удаление workspace — явное действие».
app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{id}",
    request: { params: IdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const [member] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new HTTPException(404, { message: "workspace not found" });
    }
    if (member.role !== "admin") {
      throw new HTTPException(403, { message: "admin role required" });
    }
    await db.delete(workspaces).where(eq(workspaces.id, id));
    return c.body(null, 204);
  },
);

// Membership-список workspace'а. Открыт всем member'ам (включая роль admin) —
// чтобы UI мог отрисовать секцию «Команда» и проверять «есть ли ещё admin'ы»
// перед leave-self-as-admin. Возвращает поле role; используется как
// кандидаты в default owners CRM-автоматизаций sequence.
const MemberSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  username: z.string().nullable(),
  role: z.enum(["admin", "member"]),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{id}/members",
    request: { params: IdParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(MemberSchema) } },
        description: "Workspace members",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const [self] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, id),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (!self) {
      throw new HTTPException(404, { message: "workspace not found" });
    }
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, id))
      .orderBy(workspaceMembers.createdAt);
    return c.json(rows);
  },
);

function serialize(row: {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

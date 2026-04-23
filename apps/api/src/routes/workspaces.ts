import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import {
  WorkspaceSchema as BaseWorkspaceSchema,
  CreateWorkspaceSchema as BaseCreateWorkspaceSchema,
  UpdateWorkspaceSchema as BaseUpdateWorkspaceSchema,
} from "@repo/core";
import { db } from "../db/client";
import { organizations, workspaces } from "../db/schema";
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
  // TODO: replace `createdBy = userId` with workspace_members JOIN once auth/membership lands.
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.createdBy, userId))
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
  // TODO: organization выводится из членства user'а; сейчас — единственная org этого user'а
  // (createdBy = userId). Поменять на membership-based lookup в шаге auth.
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.createdBy, userId))
    .limit(1);
  if (!org) {
    // TODO: вместо 500 — auto-create organization при первом workspace
    // (или в onboarding после OAuth). Сейчас попадаем сюда только если seed не отработал.
    throw new HTTPException(500, { message: "User has no organization" });
  }
  const [row] = await db
    .insert(workspaces)
    .values({ name, organizationId: org.id, createdBy: userId })
    .returning();
  // 8 preset-properties (full_name, description, email, phone, telegram_username,
  // url, amount, stage). Делаем всегда — без них контакты невозможно создать,
  // и UI ожидает их как identity-секцию карточки.
  await seedDefaultProperties(row!.id);
  return c.json(serialize(row!), 201);
});

// PATCH /v1/workspaces/:id — путь не матчится assertMember (тот ждёт /:id/*),
// поэтому сверяем `createdBy = userId` руками. Когда появится workspace_members,
// эта проверка переедет в общий middleware.
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
    const [row] = await db
      .update(workspaces)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), eq(workspaces.createdBy, userId)))
      .returning();
    if (!row) {
      // 404 для consistency с assertMember (не различаем "не существует" / "не ваш")
      throw new HTTPException(404, { message: "workspace not found" });
    }
    return c.json(serialize(row));
  },
);

function serialize(row: typeof workspaces.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

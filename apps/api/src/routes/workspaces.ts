import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import {
  WorkspaceSchema as BaseWorkspaceSchema,
  CreateWorkspaceSchema as BaseCreateWorkspaceSchema,
} from "@repo/core";
import { db } from "../db/client";
import { organizations, workspaces } from "../db/schema";
import type { SessionVars } from "../middleware/require-session";

const WorkspaceSchema = BaseWorkspaceSchema.openapi("Workspace");
const CreateWorkspaceSchema = BaseCreateWorkspaceSchema.openapi("CreateWorkspace");

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
  return c.json(serialize(row!), 201);
});

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

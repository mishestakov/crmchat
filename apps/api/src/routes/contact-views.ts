import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import {
  ContactViewSchema as BaseSchema,
  CreateContactViewSchema as BaseCreate,
  UpdateContactViewSchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client";
import { contactViews } from "../db/schema";
import type { WorkspaceVars } from "../middleware/assert-member";

const ContactViewSchema = BaseSchema.openapi("ContactView");
const CreateContactViewSchema = BaseCreate.openapi("CreateContactView");
const UpdateContactViewSchema = BaseUpdate.openapi("UpdateContactView");

const WsParam = z.object({ wsId: z.string().uuid() });
const WsIdParam = z.object({ wsId: z.string().uuid(), id: z.string().uuid() });

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contact-views",
    tags: ["contact-views"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ContactViewSchema) } },
        description: "Saved views",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(contactViews)
      .where(eq(contactViews.workspaceId, wsId))
      .orderBy(contactViews.createdAt);
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contact-views",
    tags: ["contact-views"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateContactViewSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ContactViewSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(contactViews)
      .values({
        workspaceId: wsId,
        name: body.name,
        mode: body.mode,
        filters: body.filters,
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contact-views/{id}",
    tags: ["contact-views"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: UpdateContactViewSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactViewSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");
    const [row] = await db
      .update(contactViews)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(contactViews.id, id), eq(contactViews.workspaceId, wsId)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "view not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/contact-views/{id}",
    tags: ["contact-views"],
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const result = await db
      .delete(contactViews)
      .where(and(eq(contactViews.id, id), eq(contactViews.workspaceId, wsId)))
      .returning({ id: contactViews.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "view not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof contactViews.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    mode: row.mode,
    filters: row.filters,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default app;

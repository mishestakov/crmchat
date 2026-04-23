import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import {
  ContactSchema as BaseContactSchema,
  CreateContactSchema as BaseCreate,
  UpdateContactSchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client";
import { contacts } from "../db/schema";
import { validateContactProperties } from "../lib/contact-properties";
import type { WorkspaceVars } from "../middleware/assert-member";

const ContactSchema = BaseContactSchema.openapi("Contact");
const CreateContactSchema = BaseCreate.openapi("CreateContact");
const UpdateContactSchema = BaseUpdate.openapi("UpdateContact");

const WsParam = z.object({ wsId: z.string().uuid() });
const WsIdParam = z.object({ wsId: z.string().uuid(), id: z.string().uuid() });

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts",
    tags: ["contacts"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ContactSchema) } },
        description: "All contacts in the workspace",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(contacts)
      .where(eq(contacts.workspaceId, wsId))
      .orderBy(contacts.createdAt);
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts",
    tags: ["contacts"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateContactSchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const validatedProps = await validateContactProperties(wsId, body.properties);
    const [row] = await db
      .insert(contacts)
      .values({
        workspaceId: wsId,
        name: body.name ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        telegramUsername: body.telegramUsername ?? null,
        properties: validatedProps,
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Contact",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const [row] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: UpdateContactSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Для properties — merge-семантика: ключи с null/"" удаляются, остальные мерджатся
    // поверх existing. Базовые поля (name/email/...) — replace по нормальной PATCH-семантике
    // (Zod valid → значит клиент явно прислал; не присланные поля undefined → не трогаем).
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if ("name" in body) updates.name = body.name ?? null;
    if ("email" in body) updates.email = body.email ?? null;
    if ("phone" in body) updates.phone = body.phone ?? null;
    if ("telegramUsername" in body) {
      updates.telegramUsername = body.telegramUsername ?? null;
    }

    if (body.properties !== undefined) {
      const [existing] = await db
        .select({ properties: contacts.properties })
        .from(contacts)
        .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
        .limit(1);
      if (!existing) {
        throw new HTTPException(404, { message: "contact not found" });
      }
      const merged = { ...existing.properties };
      // null/"" в body.properties → удалить ключ
      for (const [k, v] of Object.entries(body.properties)) {
        if (v === null || v === "") delete merged[k];
      }
      // валидация non-null значений + merge поверх
      const validated = await validateContactProperties(wsId, body.properties);
      Object.assign(merged, validated);
      updates.properties = merged;
    }

    const [row] = await db
      .update(contacts)
      .set(updates)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/contacts/{id}",
    tags: ["contacts"],
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const result = await db
      .delete(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
      .returning({ id: contacts.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "contact not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof contacts.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    email: row.email,
    phone: row.phone,
    telegramUsername: row.telegramUsername,
    properties: row.properties,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

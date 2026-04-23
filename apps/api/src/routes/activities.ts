import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import {
  ActivitySchema as BaseActivitySchema,
  CreateActivitySchema as BaseCreate,
  UpdateActivitySchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client";
import { activities, contacts } from "../db/schema";
import type { WorkspaceVars } from "../middleware/assert-member";

const ActivitySchema = BaseActivitySchema.openapi("Activity");
const CreateActivitySchema = BaseCreate.openapi("CreateActivity");
const UpdateActivitySchema = BaseUpdate.openapi("UpdateActivity");

const ListParam = z.object({
  wsId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
});
const ItemParam = ListParam.extend({ id: z.string().min(1).max(64) });

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

async function ensureContact(wsId: string, contactId: string) {
  const [row] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), eq(contacts.workspaceId, wsId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "contact not found" });
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
    tags: ["activities"],
    request: { params: ListParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ActivitySchema) } },
        description: "Activities timeline",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { contactId } = c.req.valid("param");
    await ensureContact(wsId, contactId);
    const rows = await db
      .select()
      .from(activities)
      .where(eq(activities.contactId, contactId))
      .orderBy(desc(activities.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{contactId}/activities",
    tags: ["activities"],
    request: {
      params: ListParam,
      body: {
        content: { "application/json": { schema: CreateActivitySchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ActivitySchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { contactId } = c.req.valid("param");
    const body = c.req.valid("json");
    await ensureContact(wsId, contactId);

    const [row] = await db
      .insert(activities)
      .values({
        workspaceId: wsId,
        contactId,
        type: body.type,
        text: body.text,
        date: body.type === "reminder" ? new Date(body.date) : null,
        repeat:
          body.type === "reminder" ? body.repeat ?? "none" : "none",
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
    tags: ["activities"],
    request: {
      params: ItemParam,
      body: {
        content: { "application/json": { schema: UpdateActivitySchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ActivitySchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { contactId, id } = c.req.valid("param");
    const body = c.req.valid("json");
    await ensureContact(wsId, contactId);

    const [existing] = await db
      .select()
      .from(activities)
      .where(and(eq(activities.id, id), eq(activities.contactId, contactId)))
      .limit(1);
    if (!existing) {
      throw new HTTPException(404, { message: "activity not found" });
    }

    // date/repeat — только для reminder; явный 400 если пытаются для note.
    if (existing.type === "note") {
      if (body.date !== undefined) {
        throw new HTTPException(400, {
          message: "note cannot have date",
        });
      }
      if (body.repeat !== undefined && body.repeat !== "none") {
        throw new HTTPException(400, {
          message: "note cannot have repeat",
        });
      }
    }
    // Reminder без даты — невалидное состояние (тогда зачем reminder).
    if (existing.type === "reminder" && body.date === null) {
      throw new HTTPException(400, {
        message: "reminder must have date",
      });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.text !== undefined) updates.text = body.text;
    if (body.date !== undefined) {
      updates.date = body.date === null ? null : new Date(body.date);
    }
    if (body.repeat !== undefined) updates.repeat = body.repeat;
    if (body.status !== undefined) {
      updates.status = body.status;
      updates.completedAt =
        body.status === "completed" ? new Date() : null;
    }

    const [row] = await db
      .update(activities)
      .set(updates)
      .where(and(eq(activities.id, id), eq(activities.contactId, contactId)))
      .returning();
    return c.json(serialize(row!));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/contacts/{contactId}/activities/{id}",
    tags: ["activities"],
    request: { params: ItemParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { contactId, id } = c.req.valid("param");
    await ensureContact(wsId, contactId);
    const result = await db
      .delete(activities)
      .where(and(eq(activities.id, id), eq(activities.contactId, contactId)))
      .returning({ id: activities.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "activity not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof activities.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    contactId: row.contactId,
    type: row.type,
    text: row.text,
    date: row.date ? row.date.toISOString() : null,
    repeat: row.repeat,
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export default app;

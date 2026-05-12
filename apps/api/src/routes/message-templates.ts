import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { messageTemplates } from "../db/schema.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// Message templates — workspace-wide library цепочек сообщений (12.2.1).
// Юзер заводит «Привлечение январь 2026» / «Тёплый напоминатель» и при
// создании проекта выбирает один из них — messages копируются в новый
// project.messages. Создаётся также из проекта по кнопке «Сохранить как
// шаблон». Видны всем member'ам (для селекта), редактируют только admin'ы.

const DelaySchema = z.object({
  period: z.enum(["minutes", "hours", "days"]),
  value: z.number().int().min(0),
});

const MessageSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string(),
  warmText: z.string().nullable().optional(),
  delay: DelaySchema,
});

const TemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    messages: z.array(MessageSchema),
    createdAt: z.iso.datetime(),
  })
  .openapi("MessageTemplate");

const CreateTemplateBody = z
  .object({
    name: z.string().min(1).max(200),
    messages: z.array(MessageSchema).optional(),
  })
  .openapi("CreateMessageTemplate");

const UpdateTemplateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    messages: z.array(MessageSchema).optional(),
  })
  .openapi("UpdateMessageTemplate");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsTemplateParam = z.object({
  wsId: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/message-templates",
    tags: ["message-templates"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TemplateSchema) } },
        description: "Message templates",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.workspaceId, wsId))
      .orderBy(asc(messageTemplates.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/message-templates",
    tags: ["message-templates"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateTemplateBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: TemplateSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(messageTemplates)
      .values({
        workspaceId: wsId,
        name: body.name,
        messages: body.messages ?? [],
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/message-templates/{templateId}",
    tags: ["message-templates"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsTemplateParam,
      body: {
        content: { "application/json": { schema: UpdateTemplateBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TemplateSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { templateId } = c.req.valid("param");
    const body = c.req.valid("json");
    const [row] = await db
      .update(messageTemplates)
      .set({
        ...pickDefined(body, ["name", "messages"]),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(messageTemplates.id, templateId),
          eq(messageTemplates.workspaceId, wsId),
        ),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "template not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/message-templates/{templateId}",
    tags: ["message-templates"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsTemplateParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { templateId } = c.req.valid("param");
    // Существующие проекты, созданные из шаблона, не трогаем — их messages
    // это копия (или snapshot в scheduled_messages) и живут независимо.
    const result = await db
      .delete(messageTemplates)
      .where(
        and(
          eq(messageTemplates.id, templateId),
          eq(messageTemplates.workspaceId, wsId),
        ),
      )
      .returning({ id: messageTemplates.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "template not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof messageTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    messages: row.messages,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

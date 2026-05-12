import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { stageTemplates } from "../db/schema.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// Stage templates — workspace-wide library шаблонов стадий канбана
// (12.2). Юзер заводит «Привлечение» / «Размещение в TG» / «Удержание»
// и при создании проекта выбирает один из них — стадии копируются в
// project.stages. Видны всем member'ам (для селекта при создании
// проекта), редактируют только admin'ы.

const StageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  order: z.number().int(),
});

const TemplateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    stages: z.array(StageSchema),
    createdAt: z.iso.datetime(),
  })
  .openapi("StageTemplate");

const CreateTemplateBody = z
  .object({
    name: z.string().min(1).max(200),
    stages: z.array(StageSchema).default([]),
  })
  .openapi("CreateStageTemplate");

const UpdateTemplateBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    stages: z.array(StageSchema).optional(),
  })
  .openapi("UpdateStageTemplate");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsTemplateParam = z.object({
  wsId: z.string().min(1).max(64),
  templateId: z.string().min(1).max(64),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/stage-templates",
    tags: ["stage-templates"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TemplateSchema) } },
        description: "Stage templates",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(stageTemplates)
      .where(eq(stageTemplates.workspaceId, wsId))
      .orderBy(asc(stageTemplates.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/stage-templates",
    tags: ["stage-templates"],
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
      .insert(stageTemplates)
      .values({
        workspaceId: wsId,
        name: body.name,
        stages: body.stages,
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/stage-templates/{templateId}",
    tags: ["stage-templates"],
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
      .update(stageTemplates)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.stages !== undefined && { stages: body.stages }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(stageTemplates.id, templateId),
          eq(stageTemplates.workspaceId, wsId),
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
    path: "/v1/workspaces/{wsId}/stage-templates/{templateId}",
    tags: ["stage-templates"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsTemplateParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { templateId } = c.req.valid("param");
    // Существующие проекты, созданные из этого шаблона, НЕ трогаем —
    // их stages это копия и живёт независимо. Шаблон просто пропадает
    // из селекта при создании новых проектов.
    const result = await db
      .delete(stageTemplates)
      .where(
        and(
          eq(stageTemplates.id, templateId),
          eq(stageTemplates.workspaceId, wsId),
        ),
      )
      .returning({ id: stageTemplates.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "template not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof stageTemplates.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    stages: row.stages,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

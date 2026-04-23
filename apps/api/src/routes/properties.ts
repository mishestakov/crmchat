import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";
import {
  PropertySchema as BasePropertySchema,
  CreatePropertySchema as BaseCreate,
  UpdatePropertySchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client";
import { contacts, properties } from "../db/schema";
import type { WorkspaceVars } from "../middleware/assert-member";

// `type` в UpdatePropertySchema намеренно отсутствует: смена типа = миграция данных
// (пересборка contacts.properties[key] под другой формат), это отдельный сценарий.

// TODO: при изменении property.values (особенно single_select) проверять, что
// убираемые option.id не используются ни в одном contacts.properties[key].
// Сейчас — UI fallback показывает сырой id, БД остаётся консистентной только в одну сторону.

const PropertySchema = BasePropertySchema.openapi("Property");
const CreatePropertySchema = BaseCreate.openapi("CreateProperty");
const UpdatePropertySchema = BaseUpdate.openapi("UpdateProperty");

const WsParam = z.object({ wsId: z.string().uuid() });
const WsIdParam = z.object({ wsId: z.string().uuid(), id: z.string().uuid() });

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/properties",
    tags: ["properties"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(PropertySchema) } },
        description: "Properties of the workspace",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(properties)
      .where(eq(properties.workspaceId, wsId))
      .orderBy(properties.order, properties.createdAt);
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/properties",
    tags: ["properties"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreatePropertySchema } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: PropertySchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");
    if (body.type === "single_select" && (!body.values || body.values.length === 0)) {
      throw new HTTPException(400, {
        message: "single_select requires non-empty values[]",
      });
    }
    try {
      const [row] = await db
        .insert(properties)
        .values({
          workspaceId: wsId,
          key: body.key,
          name: body.name,
          type: body.type,
          required: body.required ?? false,
          showInList: body.showInList ?? true,
          values: body.values ?? null,
        })
        .returning();
      return c.json(serialize(row!), 201);
    } catch (e) {
      // 23505 = unique_violation в Postgres — стабильнее, чем грепать имя констрейнта.
      if (e && typeof e === "object" && (e as { code?: string }).code === "23505") {
        throw new HTTPException(409, { message: "key already exists" });
      }
      throw e;
    }
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/properties/{id}",
    tags: ["properties"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: UpdatePropertySchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: PropertySchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    // Если меняем values у *_select — определяем удалённые option.id и в той же
    // транзакции чистим их из contacts.properties[key]:
    //  - single_select: ключ удаляется (`- key`), если значение было одним из removed
    //  - multi_select: фильтруем массив без removed
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(properties)
        .where(and(eq(properties.id, id), eq(properties.workspaceId, wsId)))
        .limit(1);
      if (!existing) {
        throw new HTTPException(404, { message: "property not found" });
      }

      let removedIds: string[] = [];
      if (body.values !== undefined && existing.values) {
        const newIds = new Set((body.values ?? []).map((v) => v.id));
        removedIds = existing.values
          .map((v) => v.id)
          .filter((vid) => !newIds.has(vid));
      }

      const [updated] = await tx
        .update(properties)
        .set({ ...body, updatedAt: new Date() })
        .where(and(eq(properties.id, id), eq(properties.workspaceId, wsId)))
        .returning();

      if (removedIds.length > 0) {
        if (existing.type === "single_select") {
          await tx.execute(sql`
            UPDATE contacts
            SET properties = properties - ${existing.key}::text
            WHERE workspace_id = ${wsId}
              AND properties->>${existing.key} = ANY(${removedIds}::text[])
          `);
        } else if (existing.type === "multi_select") {
          await tx.execute(sql`
            UPDATE contacts
            SET properties = jsonb_set(
              properties,
              ARRAY[${existing.key}::text],
              COALESCE(
                (SELECT jsonb_agg(e)
                 FROM jsonb_array_elements_text(properties->${existing.key}) e
                 WHERE NOT (e = ANY(${removedIds}::text[]))),
                '[]'::jsonb
              )
            )
            WHERE workspace_id = ${wsId}
              AND jsonb_typeof(properties->${existing.key}) = 'array'
          `);
        }
      }

      return updated!;
    });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/properties/{id}",
    tags: ["properties"],
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    // Транзакция: удалить property + почистить значение по этому key из всех contacts
    // workspace'а. Иначе в JSONB остаются висячие ключи, которые позже всплывут в
    // экспорте/аналитике.
    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(properties)
        .where(and(eq(properties.id, id), eq(properties.workspaceId, wsId)))
        .returning({ key: properties.key });
      if (!deleted) {
        throw new HTTPException(404, { message: "property not found" });
      }
      await tx
        .update(contacts)
        .set({ properties: sql`${contacts.properties} - ${deleted.key}` })
        .where(eq(contacts.workspaceId, wsId));
    });
    return c.body(null, 204);
  },
);

function serialize(row: typeof properties.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    name: row.name,
    type: row.type,
    order: row.order,
    required: row.required,
    showInList: row.showInList,
    values: row.values,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

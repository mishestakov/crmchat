import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, getTableColumns, ilike, or, sql, type SQL } from "drizzle-orm";
import {
  ContactSchema as BaseContactSchema,
  CreateContactSchema as BaseCreate,
  UpdateContactSchema as BaseUpdate,
} from "@repo/core";
import { db } from "../db/client";
import { contacts, properties as propsTable } from "../db/schema";
import {
  enforceRequiredProperties,
  loadPropertyDefs,
  validateContactProperties,
} from "../lib/contact-properties";
import type { WorkspaceVars } from "../middleware/assert-member";

// Subquery: ближайший открытый reminder для контакта. Тащим в каждый GET — чтобы
// kanban-карточки могли показывать NextStep без N+1 запросов. Возвращает null,
// если у контакта нет открытых напоминаний с датой.
const nextStepSql = sql<{
  date: string;
  text: string;
  repeat: "none" | "daily" | "weekly" | "monthly";
} | null>`(
  SELECT row_to_json(a) FROM (
    SELECT date, text, repeat
    FROM activities
    WHERE activities.contact_id = contacts.id
      AND activities.type = 'reminder'
      AND activities.status = 'open'
      AND activities.date IS NOT NULL
    ORDER BY date ASC
    LIMIT 1
  ) a
)`.as("next_step");

const ContactSchema = BaseContactSchema.openapi("Contact");
const CreateContactSchema = BaseCreate.openapi("CreateContact");
const UpdateContactSchema = BaseUpdate.openapi("UpdateContact");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({ wsId: z.string().min(1).max(64), id: z.string().min(1).max(64) });

// Поиск через `q` — только по имени и telegram. У нас TG-CRM, остальные identity
// поля (email/phone/url) опциональны и редко заполнены — мусор в результатах.
const SEARCHABLE_KEYS = ["full_name", "telegram_username"];

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts",
    tags: ["contacts"],
    request: {
      params: WsParam,
      query: z.object({
        q: z.string().optional(),
        // JSON-encoded { [propertyKey]: value } — динамические ключи плохо лезут
        // в openapi typed query. Оборачиваем строкой и парсим.
        filters: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ContactSchema) } },
        description: "Contacts (опционально отфильтрованные)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { q, filters: filtersStr } = c.req.valid("query");

    let filters: Record<string, string> = {};
    if (filtersStr) {
      try {
        const parsed = JSON.parse(filtersStr);
        if (parsed && typeof parsed === "object") {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && v !== "") filters[k] = v;
          }
        }
      } catch {
        throw new HTTPException(400, { message: "filters must be valid JSON" });
      }
    }

    const conditions: SQL[] = [eq(contacts.workspaceId, wsId)];

    if (q && q.trim()) {
      const pat = `%${q.trim()}%`;
      const matchOr = or(
        ...SEARCHABLE_KEYS.map(
          (k) => ilike(sql`${contacts.properties}->>${k}`, pat) as SQL,
        ),
      );
      if (matchOr) conditions.push(matchOr);
    }

    if (Object.keys(filters).length > 0) {
      // Загружаем определения properties, чтобы выбрать оператор:
      // multi_select хранится массивом → containment, остальное → "->" сравнение.
      const defs = await db
        .select({ key: propsTable.key, type: propsTable.type })
        .from(propsTable)
        .where(eq(propsTable.workspaceId, wsId));
      const typeByKey = new Map(defs.map((d) => [d.key, d.type]));
      for (const [key, value] of Object.entries(filters)) {
        if (typeByKey.get(key) === "multi_select") {
          conditions.push(
            sql`${contacts.properties}->${key} @> ${JSON.stringify([value])}::jsonb`,
          );
        } else {
          conditions.push(sql`${contacts.properties}->>${key} = ${value}`);
        }
      }
    }

    const rows = await db
      .select({ ...getTableColumns(contacts), nextStep: nextStepSql })
      .from(contacts)
      .where(and(...conditions))
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
    const defs = await loadPropertyDefs(wsId);
    const validatedProps = validateContactProperties(defs, body.properties);

    // Дефолт для stage: если юзер не задал, ставим первую опцию воронки. Это
    // обязательное internal-поле; без значения нельзя, а ситуация «нет статуса»
    // не должна порождать «Без значения» колонку — новый лид = старт воронки.
    const stage = defs.find(
      (d) => d.key === "stage" && d.type === "single_select",
    );
    if (stage && !validatedProps.stage && stage.values?.[0]) {
      validatedProps.stage = stage.values[0].id;
    }

    enforceRequiredProperties(defs, validatedProps);
    const [inserted] = await db
      .insert(contacts)
      .values({
        workspaceId: wsId,
        properties: validatedProps,
        createdBy: userId,
      })
      .returning({ id: contacts.id });
    const row = await selectOne(wsId, inserted!.id);
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
    const row = await selectOne(wsId, id);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize(row));
  },
);

// Lookup контакта по TG-identifier'у — для chat-iframe sidebar'а: iframe
// шлёт chatOpened с peerId/username, нам надо найти соответствующий контакт.
// Возвращает 404 если не найден; фронт показывает кнопку «Создать лид».
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/contacts/lookup/by-tg",
    tags: ["contacts"],
    request: {
      params: WsParam,
      query: z.object({
        tgUserId: z.string().optional(),
        username: z.string().optional(),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ContactSchema } },
        description: "Contact",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { tgUserId, username } = c.req.valid("query");
    if (!tgUserId && !username) {
      throw new HTTPException(400, {
        message: "either tgUserId or username required",
      });
    }
    const conds: SQL[] = [];
    if (tgUserId) {
      conds.push(sql`${contacts.properties}->>'tg_user_id' = ${tgUserId}`);
    }
    if (username) {
      const u = username.replace(/^@/, "");
      conds.push(sql`${contacts.properties}->>'telegram_username' = ${u}`);
    }
    // nextStep здесь не нужен — sidebar чата рендерит компактную карточку
    // без активити. Не тащим correlated subquery.
    const [row] = await db
      .select(getTableColumns(contacts))
      .from(contacts)
      .where(and(eq(contacts.workspaceId, wsId), or(...conds)))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "contact not found" });
    return c.json(serialize({ ...row, nextStep: null }));
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

    if (body.properties === undefined) {
      // Нечего обновлять — возвращаем текущий контакт без записи.
      const row = await selectOne(wsId, id);
      if (!row) throw new HTTPException(404, { message: "contact not found" });
      return c.json(serialize(row));
    }

    const [existing] = await db
      .select({ properties: contacts.properties })
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
      .limit(1);
    if (!existing) {
      throw new HTTPException(404, { message: "contact not found" });
    }

    // null / "" / [] в body.properties → удалить ключ; остальное мерджится поверх.
    const merged = { ...existing.properties };
    for (const [k, v] of Object.entries(body.properties)) {
      if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) {
        delete merged[k];
      }
    }
    const defs = await loadPropertyDefs(wsId);
    const validated = validateContactProperties(defs, body.properties);
    Object.assign(merged, validated);
    enforceRequiredProperties(defs, merged);

    await db
      .update(contacts)
      .set({ properties: merged, updatedAt: new Date() })
      .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)));
    const row = await selectOne(wsId, id);
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

async function selectOne(wsId: string, id: string) {
  const [row] = await db
    .select({ ...getTableColumns(contacts), nextStep: nextStepSql })
    .from(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.workspaceId, wsId)))
    .limit(1);
  return row;
}

type ContactRow = typeof contacts.$inferSelect & {
  nextStep:
    | { date: string; text: string; repeat: "none" | "daily" | "weekly" | "monthly" }
    | null;
};

function serialize(row: ContactRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    properties: row.properties,
    nextStep: row.nextStep,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

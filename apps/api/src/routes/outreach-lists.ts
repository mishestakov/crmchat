import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, getTableColumns, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachLeads,
  outreachLists,
  outreachListStatus,
} from "../db/schema.ts";
import { assertListAccess, listAccessClause } from "../lib/lists-access.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// Outreach-листы (CSV-импорт): фронт парсит файл локально, шлёт JSON со
// строками лидов и meta колонок. Сервер валидирует identifier'ы (username/phone),
// дедуп в пределах листа, batch-INSERT, считает stats. Импорт синхронный —
// для типичных размеров (десятки-тысячи) укладывается в один HTTP. Для
// мегалистов: TODO async pipeline + status transitions.

const TG_USERNAME_RE = /^[a-zA-Z0-9_]{5,32}$/;
// Очень мягкий E.164 — 7-15 цифр с опциональным +. Реальная валидация
// (страна-специфичная) — выше нашей зоны ответственности; цель — отсечь
// очевидный мусор типа "тут номер" / "12".
const PHONE_RE = /^\+?\d{7,15}$/;

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsListParam = z.object({
  wsId: z.string().min(1).max(64),
  listId: z.string().min(1).max(64),
});

const ListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceType: z.literal("csv"),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      phoneColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
    }),
    status: z.enum(outreachListStatus.enumValues),
    totalSize: z.number().int().nullable(),
    importStats: z
      .object({
        imported: z.number().int(),
        skippedMissingIdentifier: z.number().int(),
        skippedInvalidPhone: z.number().int(),
        skippedDuplicate: z.number().int(),
        // Сколько лидов мы узнали в существующих contacts по username/phone:
        // у них pre-resolved tg_user_id, и sticky-резолвер при активации
        // задачи сразу повяжет их с primary_account_id контакта (вместо
        // round-robin).
        recognized: z.number().int().optional(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("OutreachList");

const LeadSchema = z
  .object({
    id: z.string(),
    username: z.string().nullable(),
    phone: z.string().nullable(),
    tgUserId: z.string().nullable(),
    properties: z.record(z.string(), z.string()),
    createdAt: z.iso.datetime(),
  })
  .openapi("OutreachLead");

const CreateListBody = z
  .object({
    name: z.string().min(1).max(200),
    sourceType: z.literal("csv"),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      phoneColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
    }),
    // Сырые строки из распарсенного CSV. Сервер вытаскивает username/phone (для
    // sending), мапит CSV-колонки на CRM-properties по propertyMappings, остальное
    // — под raw header в lead.properties (для шаблонов).
    rows: z.array(z.record(z.string(), z.string())).max(50000),
  })
  .openapi("CreateOutreachList");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/lists",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ListSchema) } },
        description: "Lists",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const rows = await db
      .select()
      .from(outreachLists)
      .where(listAccessClause(wsId, userId, role))
      .orderBy(outreachLists.createdAt);
    return c.json(rows.map(serializeList));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/lists",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateListBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ListSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const {
      usernameColumn,
      phoneColumn,
      propertyMappings = {},
    } = body.sourceMeta;

    // Валидация + dedup в одном проходе.
    const seen = new Set<string>();
    const stats = {
      imported: 0,
      skippedMissingIdentifier: 0,
      skippedInvalidPhone: 0,
      skippedDuplicate: 0,
    };
    const candidates: {
      username: string | null;
      phone: string | null;
      properties: Record<string, string>;
    }[] = [];

    for (const row of body.rows) {
      // TG username case-insensitive — нормализуем к lowercase, иначе CSV с
      // вариантами "Mike1936" / "mike1936" / "@Mike1936" даст три разных
      // dedup-key и три записи на одного и того же юзера.
      const usernameRaw =
        usernameColumn && row[usernameColumn]
          ? row[usernameColumn]!.trim().replace(/^@/, "").toLowerCase()
          : "";
      const phoneRaw =
        phoneColumn && row[phoneColumn] ? row[phoneColumn]!.trim() : "";

      const username = usernameRaw && TG_USERNAME_RE.test(usernameRaw)
        ? usernameRaw
        : null;
      let phone: string | null = null;
      if (phoneRaw) {
        const normalized = phoneRaw.replace(/[\s\-()]/g, "");
        if (PHONE_RE.test(normalized)) {
          phone = normalized.startsWith("+") ? normalized : `+${normalized}`;
        } else {
          stats.skippedInvalidPhone++;
          // если ещё и username нет — это missing-identifier, не invalid-phone.
          // Но он уже зачтён как invalid-phone, проще оставить так — главное
          // показать юзеру «N строк не прошло из-за phone-format».
          continue;
        }
      }

      if (!username && !phone) {
        stats.skippedMissingIdentifier++;
        continue;
      }

      // Identity-приоритет: если есть username (TG-уникальный идентификатор) —
      // дедупим ТОЛЬКО по нему, игнорируя phone. Иначе у одного и того же
      // блогера с username "@vasya" но разными "phone"-колонками в CSV
      // (формат-варианты, опечатки, null) будут разные dedup-ключи и в БД
      // насыпется по N строк → worker отправит N сообщений одному человеку.
      // Без username — fallback на phone (он сам по себе уникальный TG-юзер).
      const dedupKey = username ? `u:${username}` : `p:${phone}`;
      if (seen.has(dedupKey)) {
        stats.skippedDuplicate++;
        continue;
      }
      seen.add(dedupKey);

      // Build lead.properties: сначала смапленные на CRM-property keys, затем
      // оставшиеся CSV-колонки под raw header (для {{}}-подстановок). Колонки
      // username/phone уже использованы как identifier'ы — не дублируем.
      const properties: Record<string, string> = {};
      const consumed = new Set<string>();
      if (usernameColumn) consumed.add(usernameColumn);
      if (phoneColumn) consumed.add(phoneColumn);
      for (const [propKey, csvCol] of Object.entries(propertyMappings)) {
        const v = row[csvCol]?.trim();
        if (v) {
          properties[propKey] = v;
          consumed.add(csvCol);
        }
      }
      for (const [k, v] of Object.entries(row)) {
        if (consumed.has(k)) continue;
        if (v && v.trim()) properties[k] = v.trim();
      }
      candidates.push({ username, phone, properties });
    }

    // Pre-resolve sticky: без снимка lead.tg_user_id sticky-резолвер при
    // активации задачи не находит знакомых (он ходит через outreach_leads.
    // tg_user_id), и первая активация уходит в round-robin даже для
    // импортированных собеседников.
    const usernames = candidates
      .map((c) => c.username)
      .filter((x): x is string => x !== null);
    const phones = candidates
      .map((c) => c.phone)
      .filter((x): x is string => x !== null);

    const tgByUsername = new Map<string, string>();
    const tgByPhone = new Map<string, string>();
    if (usernames.length > 0 || phones.length > 0) {
      // CSV нормализует username к lowercase (см. usernameRaw выше); в
      // contacts он мог быть сохранён в любом регистре (импорт собеседников
      // пишет как пришло из TG). Match'им через lower() с обеих сторон.
      const conds: SQL[] = [];
      if (usernames.length > 0) {
        conds.push(
          inArray(
            sql`lower(${contacts.properties}->>'telegram_username')`,
            usernames,
          ),
        );
      }
      if (phones.length > 0) {
        conds.push(
          inArray(sql`${contacts.properties}->>'phone'`, phones),
        );
      }
      const known = await db
        .select({
          tgUserId: sql<string | null>`${contacts.properties}->>'tg_user_id'`,
          username: sql<
            string | null
          >`lower(${contacts.properties}->>'telegram_username')`,
          phone: sql<string | null>`${contacts.properties}->>'phone'`,
        })
        .from(contacts)
        .where(and(eq(contacts.workspaceId, wsId), or(...conds)));
      for (const k of known) {
        if (!k.tgUserId) continue;
        if (k.username) tgByUsername.set(k.username, k.tgUserId);
        if (k.phone) tgByPhone.set(k.phone, k.tgUserId);
      }
    }

    const resolved = candidates.map((c) => ({
      ...c,
      tgUserId:
        (c.username && tgByUsername.get(c.username)) ||
        (c.phone && tgByPhone.get(c.phone)) ||
        null,
    }));
    const recognized = resolved.filter((l) => l.tgUserId !== null).length;
    const finalStats = {
      ...stats,
      imported: candidates.length,
      recognized,
    };

    // Insert: сначала лист, потом batch leads.
    const [list] = await db
      .insert(outreachLists)
      .values({
        workspaceId: wsId,
        name: body.name,
        sourceType: body.sourceType,
        sourceMeta: body.sourceMeta,
        status: "completed",
        totalSize: body.rows.length,
        importStats: finalStats,
        createdBy: userId,
      })
      .returning();

    if (resolved.length > 0) {
      // Drizzle insert.values() с большим массивом → один query с N-tuple
      // VALUES; Postgres-js нормально это переваривает до десятков тысяч.
      await db.insert(outreachLeads).values(
        resolved.map((c) => ({
          workspaceId: wsId,
          listId: list!.id,
          username: c.username,
          phone: c.phone,
          tgUserId: c.tgUserId,
          properties: c.properties,
        })),
      );
    }

    return c.json(
      serializeList({ ...list!, importStats: finalStats }),
      201,
    );
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/lists/{listId}",
    tags: ["outreach"],
    request: { params: WsListParam },
    responses: {
      200: {
        content: { "application/json": { schema: ListSchema } },
        description: "List",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { listId } = c.req.valid("param");
    const row = await assertListAccess(listId, wsId, userId, role);
    return c.json(serializeList(row));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/lists/{listId}/leads",
    tags: ["outreach"],
    request: {
      params: WsListParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number().int(),
              leads: z.array(LeadSchema),
            }),
          },
        },
        description: "Paginated leads",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { listId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");

    // RBAC pre-check: 404 на чужой/несуществующий лист до подсчёта лидов.
    await assertListAccess(listId, wsId, userId, role);

    // Один query вместо count+select: window-function `COUNT(*) OVER ()` даёт
    // total на каждой строке (одинаковый по всем). Если страница пустая —
    // total=0. Сетевой round-trip 1 вместо 2.
    const rows = await db
      .select({
        ...getTableColumns(outreachLeads),
        total: sql<number>`count(*) OVER ()::int`,
      })
      .from(outreachLeads)
      .where(
        and(
          eq(outreachLeads.listId, listId),
          eq(outreachLeads.workspaceId, wsId),
        ),
      )
      .orderBy(outreachLeads.createdAt)
      .limit(limit)
      .offset(offset);
    return c.json({
      total: rows[0]?.total ?? 0,
      leads: rows.map((l) => ({
        id: l.id,
        username: l.username,
        phone: l.phone,
        tgUserId: l.tgUserId,
        properties: l.properties,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/outreach/lists/{listId}",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsListParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { listId } = c.req.valid("param");
    const result = await db
      .delete(outreachLists)
      .where(
        and(
          eq(outreachLists.id, listId),
          eq(outreachLists.workspaceId, wsId),
        ),
      )
      .returning({ id: outreachLists.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "list not found" });
    }
    return c.body(null, 204);
  },
);

function serializeList(row: typeof outreachLists.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sourceType: row.sourceType,
    sourceMeta: row.sourceMeta,
    status: row.status,
    totalSize: row.totalSize,
    importStats: row.importStats,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

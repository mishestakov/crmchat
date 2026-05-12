import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  projectImports,
  projectItems,
  scheduledMessages,
  type ProjectStage,
} from "../db/schema.ts";
import {
  contactPhoneSql,
  contactTgUserIdSql,
  contactUsernameLowerSql,
} from "../lib/contact-sql.ts";
import { assertProjectAccess } from "../lib/projects-access.ts";
import {
  buildScheduledRows,
  fillStickyFromScheduledMessages,
  resolveProjectAccountIds,
  resolveStickyByTgUserIds,
  resolveWarmTgUserIds,
} from "../lib/project-scheduling.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// CSV-импорт лидов в существующий проект. Заменяет старый
// `/outreach/lists` flow: раньше лист создавался отдельно и под него
// сразу sequence; теперь лист — это просто batch импорта в уже
// существующий проект (project_imports). Проект может иметь много batch'ей
// (этап 12.5 «доливка лидов»).

const TG_USERNAME_RE = /^[a-zA-Z0-9_]{5,32}$/;
// Очень мягкий E.164 — 7-15 цифр с опциональным +. Реальная валидация
// (страна-специфичная) — выше нашей зоны ответственности.
const PHONE_RE = /^\+?\d{7,15}$/;

const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});

const ImportSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      phoneColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
    }),
    importStats: z
      .object({
        imported: z.number().int(),
        skippedMissingIdentifier: z.number().int(),
        skippedInvalidPhone: z.number().int(),
        skippedDuplicate: z.number().int(),
        recognized: z.number().int().optional(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ProjectImport");

const CreateImportBody = z
  .object({
    name: z.string().min(1).max(200),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      phoneColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
    }),
    rows: z.array(z.record(z.string(), z.string())).max(50000),
  })
  .openapi("CreateProjectImport");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/imports",
    tags: ["projects"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ImportSchema) } },
        description: "Imports history for project",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const rows = await db
      .select()
      .from(projectImports)
      .where(eq(projectImports.projectId, projectId))
      .orderBy(asc(projectImports.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/imports",
    tags: ["projects"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: CreateImportBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ImportSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);

    // A2: в done-проект лить нельзя — цепочка уже отыграна.
    if (project.status === "done") {
      throw new HTTPException(400, {
        message: "Cannot import into completed project",
      });
    }

    const body = c.req.valid("json");
    const { usernameColumn, phoneColumn, propertyMappings = {} } = body.sourceMeta;

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
      // TG username case-insensitive: "Mike1936"/"mike1936"/"@Mike1936" —
      // один и тот же юзер, нормализуем к lowercase для dedup.
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
          continue;
        }
      }

      if (!username && !phone) {
        stats.skippedMissingIdentifier++;
        continue;
      }

      // Identity-приоритет: username важнее phone (он TG-уникальный). При
      // его наличии phone не идёт в dedup-key, иначе один и тот же блогер с
      // разными форматами phone-колонки получит N item'ов и N сообщений.
      const dedupKey = username ? `u:${username}` : `p:${phone}`;
      if (seen.has(dedupKey)) {
        stats.skippedDuplicate++;
        continue;
      }
      seen.add(dedupKey);

      // properties: смапленные на CRM-property keys + остальные CSV-колонки
      // под raw header (для {{}}-подстановок). Username/phone уже использованы
      // как identifier'ы — не дублируем.
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

    // Pre-resolve sticky: лезем в contacts по username/phone и копируем
    // tg_user_id в lead. Без этого sticky-резолвер при активации проекта
    // не находит знакомых (он ходит через project_items.tg_user_id), и
    // первая активация уходит в round-robin даже для импортированных
    // собеседников.
    const usernames = candidates
      .map((c) => c.username)
      .filter((x): x is string => x !== null);
    const phones = candidates
      .map((c) => c.phone)
      .filter((x): x is string => x !== null);

    const tgByUsername = new Map<string, string>();
    const tgByPhone = new Map<string, string>();
    if (usernames.length > 0 || phones.length > 0) {
      const conds: SQL[] = [];
      if (usernames.length > 0) {
        conds.push(inArray(contactUsernameLowerSql, usernames));
      }
      if (phones.length > 0) {
        conds.push(inArray(contactPhoneSql, phones));
      }
      const known = await db
        .select({
          tgUserId: contactTgUserIdSql,
          username: contactUsernameLowerSql,
          phone: contactPhoneSql,
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

    // INSERT batch'а импорта + лидов в одной транзакции. ON CONFLICT DO
    // NOTHING на partial unique индексе (project, lower(username)) и
    // (project, phone) — закрывает дубли с предыдущих импортов в этот
    // же проект (12.5 доливка). Считаем сколько реально вставили.
    // Дефолтная стадия для новых импортируемых лидов = первая stage
    // канбана проекта (по order). Если у проекта нет stages (теоретически
    // возможно если кто-то их все удалил) — лиды создаются с null
    // stage_id и UI покажет их в колонке «Без стадии».
    const projectStages = project.stages as ProjectStage[];
    const initialStageId =
      projectStages.length > 0
        ? [...projectStages].sort((a, b) => a.order - b.order)[0]!.id
        : null;

    // A1: для active/paused — сразу планируем scheduled_messages с offsets
    // от now(). В paused worker не отправит (фильтрует по project.status),
    // но row'ы лежат как pending → resume их подтянет. Для draft — ничего,
    // /activate подхватит все накопленные лиды единым проходом.
    const willSchedule =
      project.status === "active" || project.status === "paused";
    let accountIds: string[] = [];
    if (willSchedule) {
      accountIds = await resolveProjectAccountIds(wsId, project);
      if (accountIds.length === 0) {
        throw new HTTPException(400, {
          message: "No active outreach accounts available",
        });
      }
      if (project.messages.length === 0) {
        throw new HTTPException(400, {
          message: "Project has no messages",
        });
      }
    }

    const importRow = await db.transaction(async (tx) => {
      const [imp] = await tx
        .insert(projectImports)
        .values({
          workspaceId: wsId,
          projectId,
          name: body.name,
          sourceMeta: body.sourceMeta,
          createdBy: userId,
          // importStats заполним ниже после INSERT'а лидов.
        })
        .returning();
      if (!imp) throw new HTTPException(500, { message: "import insert failed" });

      const insertedLeads: (typeof projectItems.$inferSelect)[] = [];
      if (resolved.length > 0) {
        // Chunked insert: postgres-js биндит каждое значение как отдельный $N
        // (лимит ~65k параметров на query). 1000 строк × ~10 cols = 10k params.
        const CHUNK = 1000;
        const rows = resolved.map((c) => ({
          workspaceId: wsId,
          projectId,
          importId: imp.id,
          kind: "lead" as const,
          stageId: initialStageId,
          username: c.username,
          phone: c.phone,
          tgUserId: c.tgUserId,
          properties: c.properties,
        }));
        for (let i = 0; i < rows.length; i += CHUNK) {
          const inserted = await tx
            .insert(projectItems)
            .values(rows.slice(i, i + CHUNK))
            .onConflictDoNothing()
            .returning();
          insertedLeads.push(...inserted);
        }
      }
      const actuallyInserted = insertedLeads.length;

      // Планируем отправки для новых лидов. Sticky/warm считаются на этом
      // же tg_user_id наборе. offsets — от момента доливки.
      if (willSchedule && insertedLeads.length > 0) {
        const tgUserIds = insertedLeads
          .map((l) => l.tgUserId)
          .filter((x): x is string => x !== null);
        const priorByTgUserId = await resolveStickyByTgUserIds(wsId, tgUserIds);
        const remaining = tgUserIds.filter((id) => !priorByTgUserId.has(id));
        await fillStickyFromScheduledMessages(wsId, remaining, priorByTgUserId);
        const warmTgUserIds = await resolveWarmTgUserIds(wsId, tgUserIds);

        const scheduledRows = buildScheduledRows({
          wsId,
          project,
          accountIds,
          leads: insertedLeads.map((l) => ({
            id: l.id,
            username: l.username,
            phone: l.phone,
            tgUserId: l.tgUserId,
            properties: (l.properties ?? {}) as Record<string, unknown>,
          })),
          baseTime: new Date(),
          priorByTgUserId,
          warmTgUserIds,
        });
        const CHUNK = 1000;
        for (let i = 0; i < scheduledRows.length; i += CHUNK) {
          await tx
            .insert(scheduledMessages)
            .values(scheduledRows.slice(i, i + CHUNK));
        }
      }

      const finalStats = {
        ...stats,
        imported: actuallyInserted,
        skippedDuplicate: stats.skippedDuplicate + (resolved.length - actuallyInserted),
        recognized,
      };

      const [withStats] = await tx
        .update(projectImports)
        .set({ importStats: finalStats })
        .where(eq(projectImports.id, imp.id))
        .returning();
      return withStats!;
    });

    return c.json(serialize(importRow), 201);
  },
);

function serialize(row: typeof projectImports.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sourceMeta: row.sourceMeta,
    importStats: row.importStats,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

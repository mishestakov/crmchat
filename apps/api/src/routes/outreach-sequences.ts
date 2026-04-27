import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { and, asc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachAccounts,
  outreachLeads,
  outreachLists,
  outreachSequences,
  scheduledMessages,
  type OutreachSequenceMessage,
} from "../db/schema";
import { subscribeSequence } from "../lib/outreach-events";
import { substituteVariables } from "../lib/substitute-variables";
import type { WorkspaceVars } from "../middleware/assert-member";

// Outreach-sequence: рассылка по одному списку с N сообщениями и задержками.
// Активация = pre-schedule всех scheduled_messages с round-robin аккаунтом и
// snapshot'ом текста после {{}}-подстановок. Worker (фаза 3b) забирает pending
// scheduled_messages по sendAt + расписанию workspace.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsSeqParam = z.object({
  wsId: z.string().min(1).max(64),
  seqId: z.string().min(1).max(64),
});

const DelaySchema = z.object({
  period: z.enum(["minutes", "hours", "days"]),
  value: z.number().int().min(0).max(365),
});

const MessageSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(4000),
  delay: DelaySchema,
});

const SequenceStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "completed",
]);
const AccountsModeSchema = z.enum(["all", "selected"]);
const ContactCreationTriggerSchema = z.enum([
  "on-reply",
  "on-first-message-sent",
]);

const SequenceSchema = z.object({
  id: z.string(),
  listId: z.string(),
  name: z.string(),
  status: SequenceStatusSchema,
  accountsMode: AccountsModeSchema,
  accountsSelected: z.array(z.string()),
  messages: z.array(MessageSchema),
  contactCreationTrigger: ContactCreationTriggerSchema,
  contactDefaultOwnerIds: z.array(z.string()),
  contactDefaults: z.record(z.string(), z.unknown()),
  activatedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const CreateSequenceBody = z.object({
  listId: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
});

const UpdateSequenceBody = z.object({
  name: z.string().min(1).max(200).optional(),
  accountsMode: AccountsModeSchema.optional(),
  accountsSelected: z.array(z.string()).optional(),
  messages: z.array(MessageSchema).optional(),
  contactCreationTrigger: ContactCreationTriggerSchema.optional(),
  contactDefaultOwnerIds: z.array(z.string()).optional(),
  contactDefaults: z.record(z.string(), z.unknown()).optional(),
});

// Расширенный progress: на каждое сообщение sequence у лида либо одно
// scheduled_messages-row (одна попытка), либо ничего (msg ещё не запланирован).
// status: pending → sent → (read), либо failed/cancelled.
const LeadMessageProgressSchema = z.object({
  messageIdx: z.number().int(),
  status: z.enum(["pending", "sent", "failed", "cancelled"]),
  sentAt: z.string().datetime().nullable(),
  readAt: z.string().datetime().nullable(),
  scheduledAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});

const LeadAccountSchema = z.object({
  id: z.string(),
  firstName: z.string().nullable(),
  tgUsername: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  hasPremium: z.boolean(),
});

const LeadProgressSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  // CSV-properties (для toggle «Показать CSV-данные» в leads-таблице).
  // Сюда уезжают и raw CSV-headers, и mapped-keys.
  properties: z.record(z.string(), z.string()),
  // Аккаунт, через который отправляются сообщения этому лиду. Может быть
  // разным для разных лидов (round-robin distribution при активации).
  // null если ещё не запланировано (sequence в draft).
  account: LeadAccountSchema.nullable(),
  // Прогресс по каждому сообщению sequence. Длина массива = seq.messages.length.
  messages: z.array(LeadMessageProgressSchema),
  repliedAt: z.string().datetime().nullable(),
  contactId: z.string().nullable(),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/sequences",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(SequenceSchema) } },
        description: "Sequences",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(outreachSequences)
      .where(eq(outreachSequences.workspaceId, wsId))
      .orderBy(asc(outreachSequences.createdAt));
    return c.json(rows.map(serializeSequence));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/sequences",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateSequenceBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [list] = await db
      .select({ id: outreachLists.id })
      .from(outreachLists)
      .where(
        and(
          eq(outreachLists.id, body.listId),
          eq(outreachLists.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!list) throw new HTTPException(404, { message: "list not found" });
    const [row] = await db
      .insert(outreachSequences)
      .values({
        workspaceId: wsId,
        listId: body.listId,
        name: body.name,
        createdBy: userId,
      })
      .returning();
    return c.json(serializeSequence(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: {
      200: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Sequence",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const row = await loadSequence(wsId, seqId);
    return c.json(serializeSequence(row));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
    tags: ["outreach"],
    request: {
      params: WsSeqParam,
      body: {
        content: { "application/json": { schema: UpdateSequenceBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const body = c.req.valid("json");
    const existing = await loadSequence(wsId, seqId);

    // Snapshot-fields (зашиваются в scheduled_messages при activate) можно
    // менять только в draft. Contact-settings влияют на ещё-не-созданные
    // контакты, их можно менять в любой момент.
    const touchedSnapshot =
      body.name !== undefined ||
      body.accountsMode !== undefined ||
      body.accountsSelected !== undefined ||
      body.messages !== undefined;
    if (touchedSnapshot && existing.status !== "draft") {
      throw new HTTPException(400, {
        message:
          "Name/accounts/messages can be edited only in draft. Use contact-settings fields anytime.",
      });
    }

    const [row] = await db
      .update(outreachSequences)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.accountsMode !== undefined && {
          accountsMode: body.accountsMode,
        }),
        ...(body.accountsSelected !== undefined && {
          accountsSelected: body.accountsSelected,
        }),
        ...(body.messages !== undefined && { messages: body.messages }),
        ...(body.contactCreationTrigger !== undefined && {
          contactCreationTrigger: body.contactCreationTrigger,
        }),
        ...(body.contactDefaultOwnerIds !== undefined && {
          contactDefaultOwnerIds: body.contactDefaultOwnerIds,
        }),
        ...(body.contactDefaults !== undefined && {
          contactDefaults: body.contactDefaults,
        }),
        updatedAt: new Date(),
      })
      .where(eq(outreachSequences.id, seqId))
      .returning();
    return c.json(serializeSequence(row!));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const result = await db
      .delete(outreachSequences)
      .where(
        and(
          eq(outreachSequences.id, seqId),
          eq(outreachSequences.workspaceId, wsId),
        ),
      )
      .returning({ id: outreachSequences.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "sequence not found" });
    }
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/activate",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: {
      200: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Activated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const seq = await loadSequence(wsId, seqId);
    if (seq.status !== "draft") {
      throw new HTTPException(400, {
        message: "Only draft sequences can be activated",
      });
    }
    if (seq.messages.length === 0) {
      throw new HTTPException(400, { message: "Add at least one message" });
    }

    // Аккаунты: фильтр по mode + статус active. Banned/frozen/unauthorized/offline
    // сейчас не должен использоваться worker'ом. UI юзеру при selected'е не даст
    // выбрать неактивные, но прийти могут устаревшие IDs — отфильтруем здесь.
    const accountRows = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          eq(outreachAccounts.status, "active"),
        ),
      );
    const accountIds =
      seq.accountsMode === "all"
        ? accountRows.map((a) => a.id)
        : accountRows
            .map((a) => a.id)
            .filter((id) => seq.accountsSelected.includes(id));
    if (accountIds.length === 0) {
      throw new HTTPException(400, {
        message: "No active outreach accounts available",
      });
    }

    const allLeads = await db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.listId, seq.listId))
      .orderBy(asc(outreachLeads.createdAt));
    if (allLeads.length === 0) {
      throw new HTTPException(400, { message: "List has no leads" });
    }
    // Defense-in-depth: identity-приоритет username > phone. Один и тот же
    // TG-юзер не должен получить N сообщений из-за того, что в CSV у него
    // были разные форматы phone-колонки.
    const seen = new Set<string>();
    const leads: typeof allLeads = [];
    for (const l of allLeads) {
      const key = l.username
        ? `u:${l.username.toLowerCase()}`
        : `p:${l.phone ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push(l);
    }

    const activatedAt = new Date();
    // Для каждого message i: cumulativeOffsetMs = сумма delays[0..i] в ms.
    // delay у первого сообщения (idx=0) — это пауза от момента активации.
    const offsetsMs = cumulativeOffsetsMs(seq.messages);

    // Round-robin lead → account. Заранее: лид с тем же индексом всегда получит
    // тот же аккаунт по всей последовательности (continuity-of-identity).
    const rows = leads.flatMap((lead, leadIdx) => {
      const accountId = accountIds[leadIdx % accountIds.length]!;
      return seq.messages.map((msg, msgIdx) => ({
        workspaceId: wsId,
        sequenceId: seq.id,
        leadId: lead.id,
        accountId,
        messageIdx: msgIdx,
        text: substituteVariables(msg.text, {
          username: lead.username,
          phone: lead.phone,
          properties: lead.properties,
        }),
        sendAt: new Date(activatedAt.getTime() + offsetsMs[msgIdx]!),
      }));
    });

    await db.transaction(async (tx) => {
      // Bulk insert; insert.values() с тысячами строк — один query с большим
      // VALUES tuple, postgres-js справляется до десятков-сотен тысяч.
      await tx.insert(scheduledMessages).values(rows);
      await tx
        .update(outreachSequences)
        .set({
          status: "active",
          activatedAt,
          updatedAt: new Date(),
        })
        .where(eq(outreachSequences.id, seq.id));
    });

    const refreshed = await loadSequence(wsId, seqId);
    return c.json(serializeSequence(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/pause",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: {
      200: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Paused",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const seq = await loadSequence(wsId, seqId);
    if (seq.status !== "active") {
      throw new HTTPException(400, {
        message: "Only active sequences can be paused",
      });
    }
    // Pending scheduled_messages не трогаем — worker (фаза 3b) проверит
    // sequence.status='active' при выборке. Resume вернёт sequence в active
    // и worker подтянет всё, что должно было уйти за время паузы.
    await db
      .update(outreachSequences)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(outreachSequences.id, seq.id));
    const refreshed = await loadSequence(wsId, seqId);
    return c.json(serializeSequence(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/resume",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: {
      200: {
        content: { "application/json": { schema: SequenceSchema } },
        description: "Resumed",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const seq = await loadSequence(wsId, seqId);
    if (seq.status !== "paused") {
      throw new HTTPException(400, {
        message: "Only paused sequences can be resumed",
      });
    }
    await db
      .update(outreachSequences)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(outreachSequences.id, seq.id));
    const refreshed = await loadSequence(wsId, seqId);
    return c.json(serializeSequence(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/leads",
    tags: ["outreach"],
    request: {
      params: WsSeqParam,
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
              totalCount: z.number().int(),
              repliedCount: z.number().int(),
              leads: z.array(LeadProgressSchema),
            }),
          },
        },
        description: "Leads with progress",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");
    const seq = await loadSequence(wsId, seqId);
    const totalCount = seq.messages.length;

    // repliedAgg + leadRows независимы — параллелим. repliedCount по всему
    // списку (не пагинированному) для шапки «N ответили из M».
    const [repliedAggRows, leadRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(outreachLeads)
        .where(
          and(
            eq(outreachLeads.listId, seq.listId),
            sql`${outreachLeads.repliedAt} IS NOT NULL`,
          ),
        ),
      db
        .select({
          id: outreachLeads.id,
          username: outreachLeads.username,
          phone: outreachLeads.phone,
          properties: outreachLeads.properties,
          repliedAt: outreachLeads.repliedAt,
          contactId: outreachLeads.contactId,
          total: sql<number>`count(*) OVER ()::int`,
        })
        .from(outreachLeads)
        .where(eq(outreachLeads.listId, seq.listId))
        .orderBy(asc(outreachLeads.createdAt))
        .limit(limit)
        .offset(offset),
    ]);
    const repliedCount = repliedAggRows[0]?.count ?? 0;

    if (leadRows.length === 0) {
      return c.json({ total: 0, totalCount, repliedCount, leads: [] });
    }

    // Все scheduled_messages для этих лидов одним запросом, агрегируем в JS.
    // Колонки sentAt/readAt/error per scheduled_message нужны для UI-таблицы
    // лидов (донор-style), accountId — чтобы показать через какой аккаунт
    // рассылается этому лиду.
    const sched = await db
      .select({
        leadId: scheduledMessages.leadId,
        accountId: scheduledMessages.accountId,
        messageIdx: scheduledMessages.messageIdx,
        status: scheduledMessages.status,
        sendAt: scheduledMessages.sendAt,
        sentAt: scheduledMessages.sentAt,
        readAt: scheduledMessages.readAt,
        error: scheduledMessages.error,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.sequenceId, seqId),
          inArray(
            scheduledMessages.leadId,
            leadRows.map((l) => l.id),
          ),
        ),
      );

    // Account info — один SELECT по distinct accountIds.
    const accountIds = [...new Set(sched.map((s) => s.accountId))];
    const accountRows = accountIds.length
      ? await db
          .select({
            id: outreachAccounts.id,
            firstName: outreachAccounts.firstName,
            tgUsername: outreachAccounts.tgUsername,
            phoneNumber: outreachAccounts.phoneNumber,
            hasPremium: outreachAccounts.hasPremium,
          })
          .from(outreachAccounts)
          .where(inArray(outreachAccounts.id, accountIds))
      : [];
    const accountById = new Map(accountRows.map((a) => [a.id, a]));

    type SchedRow = typeof sched[number];
    const byLead = new Map<string, SchedRow[]>();
    for (const s of sched) {
      const arr = byLead.get(s.leadId);
      if (arr) arr.push(s);
      else byLead.set(s.leadId, [s]);
    }

    return c.json({
      total: leadRows[0]?.total ?? 0,
      totalCount,
      repliedCount,
      leads: leadRows.map((l) => {
        const items = byLead.get(l.id) ?? [];
        // Аккаунт берём из первого scheduled_message — все сообщения этого
        // лида ходят через один аккаунт (см. activate logic).
        const accountId = items[0]?.accountId ?? null;
        const account = accountId ? accountById.get(accountId) ?? null : null;
        const messages = items
          .slice()
          .sort((a, b) => a.messageIdx - b.messageIdx)
          .map((s) => ({
            messageIdx: s.messageIdx,
            status: s.status,
            sentAt: s.sentAt?.toISOString() ?? null,
            readAt: s.readAt?.toISOString() ?? null,
            scheduledAt: s.sendAt?.toISOString() ?? null,
            error: s.error,
          }));
        return {
          id: l.id,
          username: l.username,
          phone: l.phone,
          properties: l.properties,
          account,
          messages,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          contactId: l.contactId,
        };
      }),
    });
  },
);

// Sequence analytics: агрегаты sent/read/replied + timeseries.
//
// `period`: окно (дни). Влияет только на timeseries; total-метрики — за всё время.
// `grouping`: `day` / `week` / `month` — bucket для timeseries (date_trunc).
// `viewMode`:
//   - "eventDate" (по дате события): sent в день когда отправили, read когда
//     лид прочитал, replied когда лид ответил. Удобно для «когда у нас
//     активность вообще».
//   - "sendDate" (по дате отправки): read и replied отнесены к дню sentAt
//     самого исходящего, к которому относится событие. Удобно для cohort-
//     анализа «насколько эффективна была отправка такого-то дня».
const AnalyticsPointSchema = z.object({
  date: z.string(),
  sent: z.number().int(),
  read: z.number().int(),
  replied: z.number().int(),
});

const GroupingSchema = z.enum(["day", "week", "month"]);
const ViewModeSchema = z.enum(["eventDate", "sendDate"]);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/analytics",
    tags: ["outreach"],
    request: {
      params: WsSeqParam,
      query: z.object({
        period: z.coerce.number().int().min(1).max(365).default(30),
        grouping: GroupingSchema.default("day"),
        viewMode: ViewModeSchema.default("eventDate"),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              totalSent: z.number().int(),
              totalRead: z.number().int(),
              totalReplied: z.number().int(),
              totalLeads: z.number().int(),
              grouping: GroupingSchema,
              viewMode: ViewModeSchema,
              series: z.array(AnalyticsPointSchema),
            }),
          },
        },
        description: "Sequence analytics aggregates + timeseries",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const { period, grouping, viewMode } = c.req.valid("query");

    // grouping валидирован zod'ом до 'day'/'week'/'month' — кладём inline,
    // чтобы date_trunc-выражение в SELECT и GROUP BY были БУКВАЛЬНО одинаковые.
    // Через параметр postgres-js биндит как $1, и Postgres считает date_trunc($1)
    // и date_trunc($2) разными expression'ами → 42803.
    const gKw = sql.raw(`'${grouping}'`);

    // Параллельно: short loadSequence (нужен только listId) + total-агрегаты.
    const [seqRows, aggRows] = await Promise.all([
      db
        .select({ listId: outreachSequences.listId })
        .from(outreachSequences)
        .where(
          and(
            eq(outreachSequences.id, seqId),
            eq(outreachSequences.workspaceId, wsId),
          ),
        )
        .limit(1),
      db
        .select({
          sent: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.status} = 'sent')::int`,
          read: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.readAt} IS NOT NULL)::int`,
        })
        .from(scheduledMessages)
        .where(eq(scheduledMessages.sequenceId, seqId)),
    ]);
    const seq = seqRows[0];
    if (!seq) throw new HTTPException(404, { message: "sequence not found" });
    const agg = aggRows[0];

    const [leadsAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        replied: sql<number>`count(*) FILTER (WHERE ${outreachLeads.repliedAt} IS NOT NULL)::int`,
      })
      .from(outreachLeads)
      .where(eq(outreachLeads.listId, seq.listId));

    const since = new Date(Date.now() - period * 86_400_000);

    // sent buckets — всегда по sentAt.
    const sentTrunc = sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`;
    const sentRows = await db
      .select({
        bucket: sql<Date>`${sentTrunc}`,
        sent: sql<number>`count(*)::int`,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.sequenceId, seqId),
          eq(scheduledMessages.status, "sent"),
          gte(scheduledMessages.sentAt, since),
        ),
      )
      .groupBy(sentTrunc);

    // read/replied buckets — выбор по viewMode:
    //   eventDate → группируем по readAt / repliedAt
    //   sendDate  → группируем по sentAt самого исходящего
    const readTrunc =
      viewMode === "sendDate"
        ? sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`
        : sql`date_trunc(${gKw}, ${scheduledMessages.readAt})`;
    const readRows = await db
      .select({
        bucket: sql<Date>`${readTrunc}`,
        read: sql<number>`count(*)::int`,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.sequenceId, seqId),
          isNotNull(scheduledMessages.readAt),
          gte(
            viewMode === "sendDate"
              ? scheduledMessages.sentAt
              : scheduledMessages.readAt,
            since,
          ),
        ),
      )
      .groupBy(readTrunc);

    // replied: на стороне leads.repliedAt. В sendDate-режиме отнесём к дню
    // первого sentAt лида (упрощение MVP — точнее было бы "последний sentAt
    // до repliedAt").
    let repliedRows: { bucket: Date; replied: number }[];
    if (viewMode === "sendDate") {
      const sub = db
        .select({
          leadId: scheduledMessages.leadId,
          firstSentAt: sql<Date>`min(${scheduledMessages.sentAt})`.as(
            "first_sent_at",
          ),
        })
        .from(scheduledMessages)
        .innerJoin(
          outreachLeads,
          eq(outreachLeads.id, scheduledMessages.leadId),
        )
        .where(
          and(
            eq(scheduledMessages.sequenceId, seqId),
            isNotNull(scheduledMessages.sentAt),
            isNotNull(outreachLeads.repliedAt),
            gte(scheduledMessages.sentAt, since),
          ),
        )
        .groupBy(scheduledMessages.leadId)
        .as("sub");
      const subTrunc = sql`date_trunc(${gKw}, sub.first_sent_at)`;
      repliedRows = await db
        .select({
          bucket: sql<Date>`${subTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(sub)
        .groupBy(subTrunc);
    } else {
      const repTrunc = sql`date_trunc(${gKw}, ${outreachLeads.repliedAt})`;
      repliedRows = await db
        .select({
          bucket: sql<Date>`${repTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(outreachLeads)
        .where(
          and(
            eq(outreachLeads.listId, seq.listId),
            isNotNull(outreachLeads.repliedAt),
            gte(outreachLeads.repliedAt, since),
          ),
        )
        .groupBy(repTrunc);
    }

    // Bucket-ключ — UTC ISO-date "YYYY-MM-DD" (date_trunc возвращает Date в UTC).
    const bucketKey = (d: Date | string): string => {
      const dt = typeof d === "string" ? new Date(d) : d;
      return dt.toISOString().slice(0, 10);
    };
    const byBucket = new Map<
      string,
      { sent: number; read: number; replied: number }
    >();
    for (const r of sentRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.sent = r.sent;
      byBucket.set(k, e);
    }
    for (const r of readRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.read = r.read;
      byBucket.set(k, e);
    }
    for (const r of repliedRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.replied = r.replied;
      byBucket.set(k, e);
    }

    // Dense series — последовательно перечисляем bucket'ы в окне period.
    // Для day — ровно period шагов; для week/month — округляем границы.
    const series = densifySeries(period, grouping, byBucket);

    return c.json({
      totalSent: agg?.sent ?? 0,
      totalRead: agg?.read ?? 0,
      totalReplied: leadsAgg?.replied ?? 0,
      totalLeads: leadsAgg?.total ?? 0,
      grouping,
      viewMode,
      series,
    });
  },
);

function densifySeries(
  period: number,
  grouping: "day" | "week" | "month",
  byBucket: Map<string, { sent: number; read: number; replied: number }>,
): { date: string; sent: number; read: number; replied: number }[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: ReturnType<typeof densifySeries> = [];
  if (grouping === "day") {
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  } else if (grouping === "week") {
    // ISO-week start: Monday. Postgres date_trunc('week') тоже даёт Monday.
    const startOfWeek = (d: Date): Date => {
      const dow = d.getUTCDay() || 7; // Sun=7
      const r = new Date(d);
      r.setUTCDate(d.getUTCDate() - (dow - 1));
      r.setUTCHours(0, 0, 0, 0);
      return r;
    };
    const weeksBack = Math.ceil(period / 7);
    const lastMonday = startOfWeek(today);
    for (let i = weeksBack - 1; i >= 0; i--) {
      const d = new Date(lastMonday.getTime() - i * 7 * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  } else {
    // month
    const monthsBack = Math.ceil(period / 30);
    const startOfMonth = (y: number, m: number): Date => {
      const d = new Date(Date.UTC(y, m, 1));
      d.setUTCHours(0, 0, 0, 0);
      return d;
    };
    const cur = startOfMonth(today.getUTCFullYear(), today.getUTCMonth());
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(cur);
      d.setUTCMonth(cur.getUTCMonth() - i);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  }
  return out;
}

// Preview-helper: один случайный лид из листа sequence для предпросмотра
// {{}}-подстановок в редакторе сообщения. Возвращает minimal payload —
// идентификатор + properties; sequence detail-page использует его в
// `substituteVariables` чтобы показать «как будет выглядеть текст для лида».
const SampleLeadSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  properties: z.record(z.string(), z.string()),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/sample-lead",
    tags: ["outreach"],
    request: { params: WsSeqParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: SampleLeadSchema.nullable() },
        },
        description: "Random lead from sequence list (or null if empty)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { seqId } = c.req.valid("param");
    const seq = await loadSequence(wsId, seqId);
    const [row] = await db
      .select({
        id: outreachLeads.id,
        username: outreachLeads.username,
        phone: outreachLeads.phone,
        properties: outreachLeads.properties,
      })
      .from(outreachLeads)
      .where(eq(outreachLeads.listId, seq.listId))
      .orderBy(sql`random()`)
      .limit(1);
    if (!row) return c.json(null);
    return c.json({
      id: row.id,
      username: row.username,
      phone: row.phone,
      properties: row.properties,
    });
  },
);

async function loadSequence(wsId: string, seqId: string) {
  const [row] = await db
    .select()
    .from(outreachSequences)
    .where(
      and(
        eq(outreachSequences.id, seqId),
        eq(outreachSequences.workspaceId, wsId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "sequence not found" });
  return row;
}

function serializeSequence(row: typeof outreachSequences.$inferSelect) {
  return {
    id: row.id,
    listId: row.listId,
    name: row.name,
    status: row.status,
    accountsMode: row.accountsMode,
    accountsSelected: row.accountsSelected,
    messages: row.messages,
    contactCreationTrigger: row.contactCreationTrigger,
    contactDefaultOwnerIds: row.contactDefaultOwnerIds,
    contactDefaults: row.contactDefaults,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function cumulativeOffsetsMs(messages: OutreachSequenceMessage[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const m of messages) {
    acc += delayToMs(m.delay);
    out.push(acc);
  }
  return out;
}

function delayToMs(delay: { period: string; value: number }): number {
  const v = delay.value;
  switch (delay.period) {
    case "minutes":
      return v * 60_000;
    case "hours":
      return v * 3_600_000;
    case "days":
      return v * 86_400_000;
    default:
      return 0;
  }
}

// SSE-стрим обновлений sequence — фронт открывает EventSource, на каждое
// изменение в scheduled_messages этой sequence (sent/failed/cancelled +
// reply от listener'а) приходит уведомление, фронт инвалидирует кэш и
// перетягивает leads endpoint. Не openapi — EventSource не работает с
// типизированным клиентом, и schema особо не нужна.
//
// Auth работает через assertMember на /v1/workspaces/{wsId}/* (тот же middleware
// что у openapi-роутов). EventSource шлёт cookie если withCredentials:true +
// CORS allow-credentials в app.ts.
app.get(
  "/v1/workspaces/:wsId/outreach/sequences/:seqId/stream",
  async (c) => {
    const wsId = c.get("workspaceId");
    const seqId = c.req.param("seqId");
    if (!seqId) throw new HTTPException(400, { message: "seqId required" });
    // Verify sequence принадлежит workspace до открытия стрима.
    const [row] = await db
      .select({ id: outreachSequences.id })
      .from(outreachSequences)
      .where(
        and(
          eq(outreachSequences.id, seqId),
          eq(outreachSequences.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "sequence not found" });

    return streamSSE(c, async (stream) => {
      let unsub = () => {};
      stream.onAbort(() => {
        unsub();
      });
      // События от пуш-шины — отправляем «changed» сигнал, фронт сам решает что
      // перетягивать. Можно было бы слать payload, но тогда сервер должен знать
      // полную форму lead-progress'а — лишнее связывание; пусть фронт читает свой
      // же endpoint.
      unsub = subscribeSequence(seqId, () => {
        // writeSSE может бросить если клиент уже отключился между abort'ом и
        // emit'ом — глушим, иначе unhandled rejection.
        stream.writeSSE({ event: "changed", data: "1" }).catch(() => {});
      });
      // Heartbeat: иначе reverse-proxies (nginx 60s, cloudflare 100s) идлят
      // соединение. Браузер на close сам реконнектит, но между переподключениями
      // юзер увидит лаг 5-30 секунд. try/catch обязательно — sleep НЕ
      // отменяется на abort, после wake-up можем оказаться в закрытом stream
      // → writeSSE throws → unhandled rejection → Bun уронит процесс.
      try {
        while (!stream.aborted) {
          await stream.writeSSE({ event: "ping", data: "" });
          await stream.sleep(25_000);
        }
      } catch {
        // stream закрылся, выходим тихо
      }
    });
  },
);

export default app;

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  outreachAccounts,
  outreachLeads,
  outreachLists,
  outreachSequences,
  scheduledMessages,
  type OutreachSequenceMessage,
} from "../db/schema";
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

const SequenceSchema = z.object({
  id: z.string(),
  listId: z.string(),
  name: z.string(),
  status: SequenceStatusSchema,
  accountsMode: AccountsModeSchema,
  accountsSelected: z.array(z.string()),
  messages: z.array(MessageSchema),
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
});

const LeadProgressSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  phone: z.string().nullable(),
  sentCount: z.number().int(),
  totalCount: z.number().int(),
  nextSendAt: z.string().datetime().nullable(),
  hasFailed: z.boolean(),
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
    // Edit разрешён только когда sequence ещё не запущена. После activate
    // тексты уже зашиты в scheduled_messages snapshot — менять формулировку
    // через editor было бы вводящим в заблуждение (часть лидов уже получит
    // старую версию).
    if (existing.status !== "draft") {
      throw new HTTPException(400, {
        message: "Only draft sequences can be edited",
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

    const leads = await db
      .select()
      .from(outreachLeads)
      .where(eq(outreachLeads.listId, seq.listId))
      .orderBy(asc(outreachLeads.createdAt));
    if (leads.length === 0) {
      throw new HTTPException(400, { message: "List has no leads" });
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

    // repliedCount считаем по всему списку лидов (не по пагинации) — нужен в
    // шапке sequence чтобы видеть «N ответили из M», а не «N из 100 на этой странице».
    const [repliedAgg] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outreachLeads)
      .where(
        and(
          eq(outreachLeads.listId, seq.listId),
          sql`${outreachLeads.repliedAt} IS NOT NULL`,
        ),
      );
    const repliedCount = repliedAgg?.count ?? 0;

    const leadRows = await db
      .select({
        id: outreachLeads.id,
        username: outreachLeads.username,
        phone: outreachLeads.phone,
        repliedAt: outreachLeads.repliedAt,
        contactId: outreachLeads.contactId,
        total: sql<number>`count(*) OVER ()::int`,
      })
      .from(outreachLeads)
      .where(eq(outreachLeads.listId, seq.listId))
      .orderBy(asc(outreachLeads.createdAt))
      .limit(limit)
      .offset(offset);

    if (leadRows.length === 0) {
      return c.json({ total: 0, totalCount, repliedCount, leads: [] });
    }

    // Все scheduled_messages для этих лидов одним запросом, агрегируем в JS.
    // Альтернатива — group by в SQL, но JS-агрегация на 100 лидах × N msgs
    // это сотни строк, не повод усложнять.
    const sched = await db
      .select({
        leadId: scheduledMessages.leadId,
        status: scheduledMessages.status,
        sendAt: scheduledMessages.sendAt,
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

    const byLead = new Map<
      string,
      { sent: number; failed: number; nextPendingAt: Date | null }
    >();
    for (const s of sched) {
      let agg = byLead.get(s.leadId);
      if (!agg) {
        agg = { sent: 0, failed: 0, nextPendingAt: null };
        byLead.set(s.leadId, agg);
      }
      if (s.status === "sent") agg.sent++;
      else if (s.status === "failed") agg.failed++;
      else if (s.status === "pending") {
        if (!agg.nextPendingAt || s.sendAt < agg.nextPendingAt) {
          agg.nextPendingAt = s.sendAt;
        }
      }
    }

    return c.json({
      total: leadRows[0]?.total ?? 0,
      totalCount,
      repliedCount,
      leads: leadRows.map((l) => {
        const agg = byLead.get(l.id);
        return {
          id: l.id,
          username: l.username,
          phone: l.phone,
          sentCount: agg?.sent ?? 0,
          totalCount,
          nextSendAt: agg?.nextPendingAt?.toISOString() ?? null,
          hasFailed: (agg?.failed ?? 0) > 0,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          contactId: l.contactId,
        };
      }),
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

export default app;

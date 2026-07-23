// Аналитика проекта (/analytics + densifySeries). sample-lead и SSE /stream
// семантически не аналитика, но живут здесь ради сохранения глобального
// порядка регистрации роутов (openapi.json 1:1).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSENoBuffer } from "../../lib/sse.ts";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  channels,
  projectItems,
  projects,
  scheduledMessages,
} from "../../db/schema.ts";
import { subscribeProject } from "../../lib/events.ts";
import {
  assertProjectAccess,
  projectAccessClause,
} from "../../lib/projects-access.ts";
import { channelIdentifier } from "../../lib/project-scheduling.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsProjectParam } from "./shared.ts";

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
const AnalyticsPointSchema = z
  .object({
    date: z.iso.date(),
    sent: z.number().int(),
    read: z.number().int(),
    replied: z.number().int(),
  })
  .openapi("OutreachAnalyticsPoint");

const GroupingSchema = z.enum(["day", "week", "month"]);
const ViewModeSchema = z.enum(["eventDate", "sendDate"]);

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/analytics",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
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
        description: "Project analytics aggregates + timeseries",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { period, grouping, viewMode } = c.req.valid("query");

    // grouping валидирован zod'ом до 'day'/'week'/'month' — кладём inline,
    // чтобы date_trunc-выражение в SELECT и GROUP BY были БУКВАЛЬНО одинаковые.
    // Через параметр postgres-js биндит как $1, и Postgres считает date_trunc($1)
    // и date_trunc($2) разными expression'ами → 42803.
    const gKw = sql.raw(`'${grouping}'`);

    const since = new Date(Date.now() - period * 86_400_000);

    // sent buckets — всегда по sentAt.
    const sentTrunc = sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`;
    // read/replied buckets — выбор по viewMode:
    //   eventDate → группируем по readAt / repliedAt
    //   sendDate  → группируем по sentAt самого исходящего
    const readTrunc =
      viewMode === "sendDate"
        ? sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`
        : sql`date_trunc(${gKw}, ${scheduledMessages.readAt})`;

    // Все 6 запросов независимы — поднимаем параллельно. Access-check + total
    // агрегаты + per-bucket series.
    //
    // replied bucket: в sendDate-режиме относим к дню первого sentAt лида
    // (упрощение MVP — точнее было бы "последний sentAt до repliedAt").
    let repliedQuery: Promise<{ bucket: Date; replied: number }[]>;
    if (viewMode === "sendDate") {
      const sub = db
        .select({
          itemId: scheduledMessages.itemId,
          firstSentAt: sql<Date>`min(${scheduledMessages.sentAt})`.as(
            "first_sent_at",
          ),
        })
        .from(scheduledMessages)
        .innerJoin(
          projectItems,
          eq(projectItems.id, scheduledMessages.itemId),
        )
        .where(
          and(
            eq(scheduledMessages.projectId, projectId),
            isNotNull(scheduledMessages.sentAt),
            isNotNull(projectItems.repliedAt),
            gte(scheduledMessages.sentAt, since),
          ),
        )
        .groupBy(scheduledMessages.itemId)
        .as("sub");
      const subTrunc = sql`date_trunc(${gKw}, sub.first_sent_at)`;
      repliedQuery = db
        .select({
          bucket: sql<Date>`${subTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(sub)
        .groupBy(subTrunc);
    } else {
      const repTrunc = sql`date_trunc(${gKw}, ${projectItems.repliedAt})`;
      repliedQuery = db
        .select({
          bucket: sql<Date>`${repTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(projectItems)
        .where(
          and(
            eq(projectItems.projectId, projectId),
            isNotNull(projectItems.repliedAt),
            gte(projectItems.repliedAt, since),
          ),
        )
        .groupBy(repTrunc);
    }

    const [accessRows, aggRows, leadsAggRows, sentRows, readRows, repliedRows] =
      await Promise.all([
        db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              projectAccessClause(wsId, userId, role),
            ),
          )
          .limit(1),
        db
          .select({
            sent: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.status} = 'sent')::int`,
            read: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.readAt} IS NOT NULL)::int`,
          })
          .from(scheduledMessages)
          .where(eq(scheduledMessages.projectId, projectId)),
        db
          .select({
            total: sql<number>`count(*)::int`,
            replied: sql<number>`count(*) FILTER (WHERE ${projectItems.repliedAt} IS NOT NULL)::int`,
          })
          .from(projectItems)
          .where(eq(projectItems.projectId, projectId)),
        db
          .select({
            bucket: sql<Date>`${sentTrunc}`,
            sent: sql<number>`count(*)::int`,
          })
          .from(scheduledMessages)
          .where(
            and(
              eq(scheduledMessages.projectId, projectId),
              eq(scheduledMessages.status, "sent"),
              gte(scheduledMessages.sentAt, since),
            ),
          )
          .groupBy(sentTrunc),
        db
          .select({
            bucket: sql<Date>`${readTrunc}`,
            read: sql<number>`count(*)::int`,
          })
          .from(scheduledMessages)
          .where(
            and(
              eq(scheduledMessages.projectId, projectId),
              isNotNull(scheduledMessages.readAt),
              gte(
                viewMode === "sendDate"
                  ? scheduledMessages.sentAt
                  : scheduledMessages.readAt,
                since,
              ),
            ),
          )
          .groupBy(readTrunc),
        repliedQuery,
      ]);
    if (!accessRows[0]) {
      throw new HTTPException(404, { message: "project not found" });
    }
    const agg = aggRows[0];
    const leadsAgg = leadsAggRows[0];

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
const SampleLeadSchema = z
  .object({
    id: z.string(),
    username: z.string().nullable(),
    properties: z.record(z.string(), z.string()),
  })
  .openapi("OutreachSampleLead");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/sample-lead",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: SampleLeadSchema.nullable() },
        },
        description: "Random lead from project (or null if empty)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    // count + OFFSET вместо ORDER BY random() — Postgres делает full sort
    // на каждый клик «Другой лид»; на больших проектах это заметно.
    const [cntRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(projectItems)
      .where(eq(projectItems.projectId, project.id));
    const cnt = cntRow?.cnt ?? 0;
    if (cnt === 0) return c.json(null);
    const [row] = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        properties: projectItems.properties,
        channelTitle: channels.title,
        channelUsername: channels.username,
        channelLink: channels.link,
        channelPlatform: channels.platform,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(eq(projectItems.projectId, project.id))
      .limit(1)
      .offset(Math.floor(Math.random() * cnt));
    if (!row) return c.json(null);
    // Дешёвое превью: канало-переменные синтезируем инлайн из канала сэмпла
    // (тем же channelIdentifier, что и prepareLeads). Это приближение —
    // {{каналы}} тут = один канал сэмпла, а при реальной отправке = склейка всех
    // каналов админа; для превью «как примерно будет» этого достаточно, без
    // лишних запросов prepareLeads на каждый клик «Другой лид».
    const channelVars: Record<string, string> = {};
    if (row.channelPlatform) {
      const { ident, link } = channelIdentifier({
        platform: row.channelPlatform,
        username: row.channelUsername,
        title: row.channelTitle,
        link: row.channelLink,
      });
      channelVars.каналы = ident;
      channelVars.канал = row.channelTitle ?? ident;
      if (link) channelVars.ссылка = link;
    }
    return c.json({
      id: row.id,
      username: row.username,
      properties: { ...row.properties, ...channelVars },
    });
  },
);

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
  "/v1/workspaces/:wsId/projects/:projectId/stream",
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const projectId = c.req.param("projectId");
    if (!projectId) throw new HTTPException(400, { message: "projectId required" });
    // Verify sequence доступна юзеру до открытия стрима (RBAC).
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          projectAccessClause(wsId, userId, role),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "project not found" });

    return streamSSENoBuffer(c, async (stream) => {
      let unsub = () => {};
      stream.onAbort(() => {
        unsub();
      });
      // События от пуш-шины — отправляем «changed» сигнал, фронт сам решает что
      // перетягивать. Можно было бы слать payload, но тогда сервер должен знать
      // полную форму lead-progress'а — лишнее связывание; пусть фронт читает свой
      // же endpoint.
      unsub = subscribeProject(projectId, () => {
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

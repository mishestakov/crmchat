import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channels,
  projectItems,
  projects,
  projectShares,
  tracks,
  workspaces,
} from "../db/schema.ts";
import { type SessionVars } from "../middleware/require-session.ts";

// Клиентский доступ по magic-link (без аккаунта/сессии). Доступ = знание
// токена. Каждый endpoint резолвит токен → projectId, валидирует (не отозван,
// не истёк). Клиент видит ТОЛЬКО свою кампанию (шортлист), без цен блогерам
// (спека §5.5) и без других кампаний/клиентов агентства.
//
// Монтируется на app напрямую (НЕ под requireSession/assertMember).

const TokenParam = z.object({ token: z.string().min(1).max(128) });
const PlacementTokenParam = TokenParam.extend({
  placementId: z.string().min(1).max(64),
});

const ClientPlacementSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        title: z.string(),
        username: z.string().nullable(),
        memberCount: z.number().int().nullable(),
      })
      .nullable(),
    // Цену блогеру клиенту НЕ показываем — только прогнозы.
    forecastViews: z.number().int().nullable(),
    forecastErr: z.number().nullable(),
    clientStatus: z.enum(["pending", "approved", "rejected", "replace"]),
    clientStatusComment: z.string().nullable(),
  })
  .openapi("ClientPlacement");

const ClientProjectSchema = z
  .object({
    campaignName: z.string(),
    clientName: z.string(),
    agencyName: z.string(),
    brief: z.string().nullable(),
    placements: z.array(ClientPlacementSchema),
  })
  .openapi("ClientProject");

const app = new OpenAPIHono<{ Variables: SessionVars }>();

// Резолв токена → доступ. Обновляет last_seen_at. 401 если невалиден.
async function resolveShare(token: string) {
  const [share] = await db
    .select({
      id: projectShares.id,
      projectId: projectShares.projectId,
      workspaceId: projectShares.workspaceId,
    })
    .from(projectShares)
    .where(
      and(
        eq(projectShares.token, token),
        isNull(projectShares.revokedAt),
        or(
          isNull(projectShares.expiresAt),
          gt(projectShares.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  if (!share) {
    throw new HTTPException(401, { message: "Ссылка недействительна" });
  }
  // Fire-and-forget last_seen — не блокируем ответ. .catch обязателен: без
  // него транзиентная ошибка БД на этом UPDATE = unhandled rejection, а Node
  // 24 (--unhandled-rejections=throw) уронит весь процесс от анонимного трафика.
  void db
    .update(projectShares)
    .set({ lastSeenAt: new Date() })
    .where(eq(projectShares.id, share.id))
    .catch(() => {});
  return share;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/{token}/project",
    tags: ["share-client"],
    request: { params: TokenParam },
    responses: {
      200: {
        content: { "application/json": { schema: ClientProjectSchema } },
        description: "Client view: campaign + shortlist",
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const share = await resolveShare(token);

    const [project] = await db
      .select({
        name: projects.name,
        brief: projects.brief,
        clientName: tracks.name,
        agencyName: workspaces.name,
      })
      .from(projects)
      .innerJoin(tracks, eq(tracks.id, projects.trackId))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(eq(projects.id, share.projectId))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: "not found" });

    // Только шортлист (shortlisted_at NOT NULL) — то, что агентство отобрало.
    const rows = await db
      .select({
        id: projectItems.id,
        forecastViews: projectItems.forecastViews,
        forecastErr: projectItems.forecastErr,
        clientStatus: projectItems.clientStatus,
        clientStatusComment: projectItems.clientStatusComment,
        channelTitle: channels.title,
        channelUsername: channels.username,
        channelMembers: channels.memberCount,
        channelId: channels.id,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.projectId, share.projectId),
          eq(projectItems.kind, "placement"),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    return c.json({
      campaignName: project.name,
      clientName: project.clientName,
      agencyName: project.agencyName,
      brief: project.brief,
      placements: rows.map((r) => ({
        id: r.id,
        channel: r.channelId
          ? {
              title: r.channelTitle ?? "—",
              username: r.channelUsername,
              memberCount: r.channelMembers,
            }
          : null,
        forecastViews: r.forecastViews,
        forecastErr: r.forecastErr === null ? null : Number(r.forecastErr),
        clientStatus: r.clientStatus,
        clientStatusComment: r.clientStatusComment,
      })),
    });
  },
);

const DecisionBody = z
  .object({ comment: z.string().max(2000).optional() })
  .openapi("ShareApprove");
const RejectBody = z
  .object({
    comment: z.string().min(1).max(2000),
    replace: z.boolean().optional(),
  })
  .openapi("ShareReject");

// Обновляет client_status размещения, проверив что оно в шортлисте этой кампании.
async function setDecision(
  token: string,
  placementId: string,
  status: "approved" | "rejected" | "replace",
  comment: string | null,
) {
  const share = await resolveShare(token);
  const [row] = await db
    .update(projectItems)
    .set({
      clientStatus: status,
      clientStatusComment: comment,
      clientStatusAt: new Date(),
    })
    .where(
      and(
        eq(projectItems.id, placementId),
        eq(projectItems.projectId, share.projectId),
        eq(projectItems.kind, "placement"),
        sql`${projectItems.shortlistedAt} IS NOT NULL`,
      ),
    )
    .returning({ id: projectItems.id });
  if (!row) throw new HTTPException(404, { message: "placement not found" });
}

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/share/{token}/placements/{placementId}/approve",
    tags: ["share-client"],
    request: {
      params: PlacementTokenParam,
      body: { content: { "application/json": { schema: DecisionBody } }, required: true },
    },
    responses: { 204: { description: "Approved" } },
  }),
  async (c) => {
    const { token, placementId } = c.req.valid("param");
    const { comment } = c.req.valid("json");
    await setDecision(token, placementId, "approved", comment ?? null);
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/share/{token}/placements/{placementId}/reject",
    tags: ["share-client"],
    request: {
      params: PlacementTokenParam,
      body: { content: { "application/json": { schema: RejectBody } }, required: true },
    },
    responses: { 204: { description: "Rejected" } },
  }),
  async (c) => {
    const { token, placementId } = c.req.valid("param");
    const { comment, replace } = c.req.valid("json");
    await setDecision(token, placementId, replace ? "replace" : "rejected", comment);
    return c.body(null, 204);
  },
);

export default app;

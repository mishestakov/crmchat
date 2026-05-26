import { randomBytes } from "node:crypto";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { projectShares } from "../db/schema.ts";
import { assertProjectAccess } from "../lib/projects-access.ts";
import { type WorkspaceVars } from "../middleware/assert-member.ts";

// Управление magic-link'ами клиента (member-side). Генерация/список/отзыв
// ссылок на шортлист кампании. Клиентский доступ к данным — в share-client.ts
// (по токену, без member-auth).

const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});
const ShareParam = WsProjectParam.extend({
  shareId: z.string().min(1).max(64),
});

const ShareSchema = z
  .object({
    id: z.string(),
    token: z.string(),
    // Относительный путь — фронт добавляет origin для полной ссылки.
    url: z.string(),
    label: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    lastSeenAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ProjectShare");

const CreateShareBody = z
  .object({
    label: z.string().max(200).optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .openapi("CreateProjectShare");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/shares",
    tags: ["shares"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ShareSchema) } },
        description: "Active shares",
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
      .from(projectShares)
      .where(
        and(
          eq(projectShares.projectId, projectId),
          isNull(projectShares.revokedAt),
        ),
      )
      .orderBy(asc(projectShares.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/shares",
    tags: ["shares"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: CreateShareBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ShareSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const token = randomBytes(32).toString("base64url");
    const [row] = await db
      .insert(projectShares)
      .values({
        workspaceId: wsId,
        projectId,
        token,
        label: body.label ?? null,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/shares/{shareId}",
    tags: ["shares"],
    request: { params: ShareParam },
    responses: { 204: { description: "Revoked" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, shareId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .update(projectShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(projectShares.id, shareId),
          eq(projectShares.projectId, projectId),
          isNull(projectShares.revokedAt),
        ),
      )
      .returning({ id: projectShares.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "share not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof projectShares.$inferSelect) {
  return {
    id: row.id,
    token: row.token,
    url: `/share/${row.token}`,
    label: row.label,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { trackKind, tracks } from "../db/schema.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// Track — папка проектов в workspace. Для BD-команды (kind='program'):
// «Привлечение/Удержание/Отток/Ad-hoc». Для агентства (kind='client'):
// «Coca-Cola/Beeline». Видимость треков — у всех member'ов; RBAC живёт
// на уровне Project (см. lib/projects-access.ts).

const TrackKindSchema = z.enum(trackKind.enumValues);

const TrackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: TrackKindSchema,
    properties: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .openapi("Track");

const CreateTrackBody = z
  .object({
    name: z.string().min(1).max(200),
    kind: TrackKindSchema.default("generic"),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("CreateTrack");

const UpdateTrackBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("UpdateTrack");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsTrackParam = z.object({
  wsId: z.string().min(1).max(64),
  trackId: z.string().min(1).max(64),
});

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/tracks",
    tags: ["tracks"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(TrackSchema) } },
        description: "Tracks",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(tracks)
      .where(eq(tracks.workspaceId, wsId))
      .orderBy(asc(tracks.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/tracks",
    tags: ["tracks"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateTrackBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: TrackSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [row] = await db
      .insert(tracks)
      .values({
        workspaceId: wsId,
        name: body.name,
        kind: body.kind,
        properties: body.properties ?? {},
        createdBy: userId,
      })
      .returning();
    return c.json(serialize(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/tracks/{trackId}",
    tags: ["tracks"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsTrackParam,
      body: {
        content: { "application/json": { schema: UpdateTrackBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: TrackSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { trackId } = c.req.valid("param");
    const body = c.req.valid("json");
    const [row] = await db
      .update(tracks)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.properties !== undefined && { properties: body.properties }),
        updatedAt: new Date(),
      })
      .where(and(eq(tracks.id, trackId), eq(tracks.workspaceId, wsId)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "track not found" });
    return c.json(serialize(row));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/tracks/{trackId}",
    tags: ["tracks"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsTrackParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { trackId } = c.req.valid("param");
    const result = await db
      .delete(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.workspaceId, wsId)))
      .returning({ id: tracks.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "track not found" });
    }
    return c.body(null, 204);
  },
);

function serialize(row: typeof tracks.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    properties: row.properties,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { EMPTY_DUNNING, workspaces } from "../db/schema.ts";
import { DunningSchema } from "./projects/shared.ts";
import type { WorkspaceVars } from "../middleware/assert-member.ts";

// Пиналка (догон) — одна на воркспейс (§1.3 bd-autodogon): фразы + котики +
// каданс одинаковы во всех проектах. Опенер — проектный (свой питч у кампании).
// Хранится в workspaces.dunning. Валидация достаточности пула — в DunningSchema.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/dunning",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: DunningSchema } },
        description: "Dunning",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const [row] = await db
      .select({ dunning: workspaces.dunning })
      .from(workspaces)
      .where(eq(workspaces.id, wsId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "workspace not found" });
    return c.json(row.dunning ?? EMPTY_DUNNING);
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/outreach/dunning",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: DunningSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: DunningSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");
    const [row] = await db
      .update(workspaces)
      .set({ dunning: body, updatedAt: new Date() })
      .where(eq(workspaces.id, wsId))
      .returning({ dunning: workspaces.dunning });
    return c.json(row!.dunning ?? EMPTY_DUNNING);
  },
);

export default app;

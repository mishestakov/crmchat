import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import type { SessionVars } from "../middleware/require-session";

const Me = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().nullable(),
    username: z.string().nullable(),
  })
  .openapi("Me");

const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/auth/me",
    tags: ["auth"],
    responses: {
      200: {
        content: { "application/json": { schema: Me } },
        description: "Current user",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const [u] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u) throw new HTTPException(401, { message: "user vanished" });
    return c.json(u);
  },
);

export default app;

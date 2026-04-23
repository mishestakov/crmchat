import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createSession, destroySession } from "../lib/sessions";

const app = new OpenAPIHono();

// Двойной гейт: одной env-переменной не хватит на prod-страховку.
// NODE_ENV должен быть строго "development" (не "test", не "staging"), И
// явный opt-in ALLOW_DEV_AUTH=true. Опечатка в env → ручка не появится.
const isDevAuthEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.ALLOW_DEV_AUTH === "true";

if (isDevAuthEnabled) {
  const DevUser = z
    .object({
      id: z.string().min(1).max(64),
      email: z.string(),
      name: z.string().nullable(),
    })
    .openapi("DevUser");

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/_dev/users",
      tags: ["dev"],
      responses: {
        200: {
          content: { "application/json": { schema: z.array(DevUser) } },
          description: "Dev users available for impersonation",
        },
      },
    }),
    async (c) => {
      const rows = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .orderBy(users.email);
      return c.json(rows);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/_dev/login",
      tags: ["dev"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ userId: z.string().min(1).max(64) }),
            },
          },
          required: true,
        },
      },
      responses: { 204: { description: "Cookie set" } },
    }),
    async (c) => {
      const { userId } = c.req.valid("json");
      const [u] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!u) throw new HTTPException(404, { message: "user not found" });
      await createSession(c, userId);
      return c.body(null, 204);
    },
  );
}

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/auth/logout",
    tags: ["auth"],
    responses: { 204: { description: "Cookie cleared" } },
  }),
  async (c) => {
    const sid = getCookie(c, "sid");
    if (sid) await destroySession(c, sid);
    return c.body(null, 204);
  },
);

export default app;

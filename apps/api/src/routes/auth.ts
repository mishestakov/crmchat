import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { createSession, destroySession } from "../lib/sessions.ts";
import { consumeBridgeToken } from "../lib/bridge-tokens.ts";
import {
  issueAuthToken,
  checkAuthToken,
  handleUpdate,
  getWebhookSecret,
  isBotConfigured,
  type TgUpdate,
} from "../lib/tg-bot.ts";

const app = new OpenAPIHono();

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/auth/finish",
    tags: ["auth"],
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ bt: z.string().min(1).max(128) }) },
        },
        required: true,
      },
    },
    responses: { 204: { description: "Session cookie set" } },
  }),
  async (c) => {
    const { bt } = c.req.valid("json");
    const userId = consumeBridgeToken(bt);
    if (!userId) throw new HTTPException(401, { message: "invalid bridge token" });
    await createSession(c, userId);
    return c.body(null, 204);
  },
);

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
        .select({ id: users.id, name: users.name })
        .from(users)
        .orderBy(users.id);
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

// === Telegram Bot deep-link auth flow ============================================
// Основной (и единственный) login-флоу — обходит RKN-блокировку oauth.telegram.org,
// до которого OIDC-вариант на RU-сервере не достучаться.
// SPA вызывает /start → получает token + t.me-ссылку → опрашивает /poll каждые
// несколько секунд → когда юзер подтвердил в TG-боте, /poll возвращает bridge-token,
// SPA дальше идёт обычным путём через /v1/auth/finish.

app.post("/v1/auth/tg-bot/start", async (c) => {
  if (!isBotConfigured()) {
    throw new HTTPException(503, { message: "tg bot not configured" });
  }
  const { token, deepLink } = issueAuthToken();
  return c.json({ token, deepLink });
});

app.get("/v1/auth/tg-bot/poll", async (c) => {
  const token = c.req.query("token") ?? "";
  if (!token) throw new HTTPException(400, { message: "token required" });
  const result = checkAuthToken(token);
  return c.json(result);
});

// Webhook от Telegram Bot API. Защищён secret_token, который TG ставит в
// X-Telegram-Bot-Api-Secret-Token (см. setWebhook params).
app.post("/v1/webhooks/tg-bot", async (c) => {
  // Если secret в env пустой — ручка глобально закрыта (защита от случайной
  // публикации webhook'а без anti-spoof, где `provided === ""` иначе матчил бы).
  const secret = getWebhookSecret();
  const provided = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || !provided || provided !== secret) {
    return c.body(null, 403);
  }
  const update = (await c.req.json()) as TgUpdate;
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("[tg-bot] handleUpdate failed:", e);
  }
  return c.body(null, 200);
});

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

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { users } from "../db/schema";
import { createSession, destroySession } from "../lib/sessions";
import {
  buildAuthorizationUrl,
  exchangeCodeForIdToken,
  makePkceChallenge,
  makePkceVerifier,
  makeState,
} from "../lib/tg-oidc";
import { issueBridgeToken, consumeBridgeToken } from "../lib/bridge-tokens";

const app = new OpenAPIHono();

const OIDC_COOKIE = "tg_oidc";
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");

// Whitelist для post-login редиректа. Принимаем только same-origin path:
// начинается с одиночного '/', НЕ начинается с '//' или '/\\' (protocol-relative
// и backslash-trick ломают same-origin), без CR/LF (header injection),
// разумная длина. Возвращает path или null. Используется в /auth/start
// (для сохранения в OIDC-cookie) и в /auth/callback (на финальном редиректе
// в /auth/finish?next=...) — defense-in-depth: фронт `/auth/finish` тоже
// валидирует ещё раз.
function safeNext(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\r\n]/.test(raw)) return null;
  return raw;
}

app.get("/v1/auth/telegram/start", async (c) => {
  const verifier = makePkceVerifier();
  const state = makeState();
  const next = safeNext(c.req.query("next"));
  setCookie(c, OIDC_COOKIE, JSON.stringify({ verifier, state, next }), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  });
  return c.redirect(
    buildAuthorizationUrl({ state, codeChallenge: makePkceChallenge(verifier) }),
    302,
  );
});

app.get("/v1/auth/telegram/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const oidcCookie = getCookie(c, OIDC_COOKIE);
  deleteCookie(c, OIDC_COOKIE, { path: "/" });

  const fail = () => c.redirect(`${WEB_ORIGIN}/login?error=1`, 302);
  if (!code || !state || !oidcCookie) return fail();
  const stored = JSON.parse(oidcCookie) as {
    verifier: string;
    state: string;
    next?: string | null;
  };
  if (stored.state !== state) return fail();

  const claims = await exchangeCodeForIdToken({ code, codeVerifier: stored.verifier });
  const profile = { name: claims.name, username: claims.preferred_username };
  const [row] = await db
    .insert(users)
    .values({ tgUserId: claims.sub, ...profile })
    .onConflictDoUpdate({
      target: users.tgUserId,
      set: { ...profile, updatedAt: new Date() },
    })
    .returning({ id: users.id });

  // В prod заменить на createSession(c, row!.id) + redirect (next ?? "/"),
  // см. bridge-tokens.ts.
  const bt = issueBridgeToken(row!.id);
  const next = safeNext(stored.next);
  const finishUrl = new URL(`${WEB_ORIGIN}/auth/finish`);
  finishUrl.searchParams.set("bt", bt);
  if (next) finishUrl.searchParams.set("next", next);
  return c.redirect(finishUrl.toString(), 302);
});

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

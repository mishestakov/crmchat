import type { MiddlewareHandler } from "hono";

// DEV ONLY — заменяется на cookie-сессию в шаге auth (specs/auth.md).
// Если DEV_USER_ID не задан → 500: гарантия, что dev-stub не утечёт в prod без подмены.
export const devAuth: MiddlewareHandler<{
  Variables: { userId: string };
}> = async (c, next) => {
  const userId = process.env.DEV_USER_ID;
  if (!userId) {
    return c.json(
      { error: "DEV_USER_ID is not set; auth middleware not configured" },
      500,
    );
  }
  c.set("userId", userId);
  await next();
};

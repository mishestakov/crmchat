import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/client";
import { sessions } from "../db/schema";

export type SessionVars = { userId: string; sessionId: string };

export const requireSession: MiddlewareHandler<{ Variables: SessionVars }> =
  async (c, next) => {
    const sid = getCookie(c, "sid");
    if (!sid) throw new HTTPException(401, { message: "no session" });
    const [row] = await db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.id, sid), gt(sessions.expiresAt, new Date())))
      .limit(1);
    if (!row) {
      throw new HTTPException(401, { message: "session invalid or expired" });
    }
    c.set("sessionId", sid);
    c.set("userId", row.userId);
    await next();
  };

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { Api, type TelegramClient } from "telegram";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { outreachAccounts } from "../db/schema";
import { errMsg } from "../lib/errors";
import {
  clearPendingOutreachClient,
  deleteOutreachAccount,
  getOrCreatePendingOutreachClient,
  persistOutreachAccount,
} from "../lib/outreach-account-client";
import { qrKey, streamQrState } from "../lib/qr-token-cache";
import { tgApiHash as apiHash, tgApiId as apiId } from "../lib/telegram-client";
import {
  pickActiveUsername,
  type TgPendingHelpers,
  tgReadQrState,
  tgSendCode,
  tgSignIn,
  tgSignInPassword,
} from "../lib/tg-auth";
import { toTwaSession } from "../lib/twa-session";
import type { WorkspaceVars } from "../middleware/assert-member";

// Outreach-аккаунты: ОТПРАВЛЯЮЩИЕ TG-аккаунты для холодных рассылок (multi per
// workspace). Auth-флоу делит реализацию с user-scoped /v1/telegram/* через
// lib/tg-auth; разница только в pending-кэше (per workspace) и postauth-логике
// (persistOutreachAccount возвращает accountId, плюс держит worker+iframe).

const helpers = (wsId: string): TgPendingHelpers => ({
  getPending: () => getOrCreatePendingOutreachClient(wsId),
  clearPending: () => clearPendingOutreachClient(wsId),
  cacheKey: qrKey.outreach(wsId),
});

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsAccountParam = z.object({
  wsId: z.string().min(1).max(64),
  accountId: z.string().min(1).max(64),
});

const AccountSchema = z.object({
  id: z.string(),
  status: z.enum(["active", "banned", "frozen", "unauthorized", "offline"]),
  tgUserId: z.string(),
  tgUsername: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  firstName: z.string().nullable(),
  hasPremium: z.boolean(),
  newLeadsDailyLimit: z.number().int(),
  createdAt: z.string().datetime(),
});

const PatchAccountBody = z.object({
  newLeadsDailyLimit: z.number().int().min(0).max(1000).optional(),
});

// Session в формате который ждёт TG-клиент (apps/tg-client). Это фактически
// authKey + dcId из gramjs StringSession в hex-формате. Передаётся фронту →
// фронт через postMessage инжектит в iframe.
const TwaSessionResponseSchema = z.object({
  session: z.object({
    mainDcId: z.number().int(),
    keys: z.record(z.string(), z.string()),
    isTest: z.literal(true).optional(),
  }),
});

function serializeAccount(r: typeof outreachAccounts.$inferSelect) {
  return {
    id: r.id,
    status: r.status,
    tgUserId: r.tgUserId,
    tgUsername: r.tgUsername,
    phoneNumber: r.phoneNumber,
    firstName: r.firstName,
    hasPremium: r.hasPremium,
    newLeadsDailyLimit: r.newLeadsDailyLimit,
    createdAt: r.createdAt.toISOString(),
  };
}

const SendCodeRespSchema = z.object({
  phoneCodeHash: z.string(),
  isCodeViaApp: z.boolean(),
});

const SignInRespSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sign_in_complete"), accountId: z.string() }),
  z.object({ status: z.literal("password_needed") }),
  z.object({ status: z.literal("phone_code_invalid") }),
  z.object({ status: z.literal("user_not_found") }),
]);

const SignInPasswordRespSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sign_in_complete"), accountId: z.string() }),
  z.object({ status: z.literal("password_invalid") }),
]);


const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/accounts",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(AccountSchema) } },
        description: "Outreach accounts",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(outreachAccounts)
      .where(eq(outreachAccounts.workspaceId, wsId))
      .orderBy(outreachAccounts.createdAt);
    return c.json(rows.map(serializeAccount));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
    tags: ["outreach"],
    request: { params: WsAccountParam },
    responses: {
      200: {
        content: { "application/json": { schema: AccountSchema } },
        description: "Account",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("param");
    const [row] = await db
      .select()
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "account not found" });
    return c.json(serializeAccount(row));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
    tags: ["outreach"],
    request: {
      params: WsAccountParam,
      body: {
        content: { "application/json": { schema: PatchAccountBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: AccountSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("param");
    const body = c.req.valid("json");
    const [row] = await db
      .update(outreachAccounts)
      .set({
        // Drizzle игнорит undefined-поля, не пишет их в SET. Если body пустой —
        // фактически апдейтится только updatedAt (idempotent ping).
        newLeadsDailyLimit: body.newLeadsDailyLimit,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .returning();
    if (!row) throw new HTTPException(404, { message: "account not found" });
    return c.json(serializeAccount(row));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/twa-session",
    tags: ["outreach"],
    request: { params: WsAccountParam },
    responses: {
      200: {
        content: { "application/json": { schema: TwaSessionResponseSchema } },
        description: "Session in TWA format for iframe injection",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("param");
    const [row] = await db
      .select({ session: outreachAccounts.session })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "account not found" });

    const session = await toTwaSession(row.session);
    if (!session) {
      throw new HTTPException(409, {
        message: "session corrupted, re-auth required",
      });
    }

    // no-store: response содержит MTProto authKey — полный контроль над TG-
    // аккаунтом. Запрещаем кэш (browser disk, прокси, CDN).
    c.header("Cache-Control", "no-store, private");
    return c.json({ session });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/auth/send-code",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ phoneNumber: z.string().min(5).max(32) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SendCodeRespSchema } },
        description: "Code sent",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { phoneNumber } = c.req.valid("json");
    try {
      return c.json(
        await tgSendCode(helpers(wsId), apiId, apiHash, phoneNumber),
      );
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              phoneNumber: z.string().min(5).max(32),
              phoneCode: z.string().min(1).max(16),
              phoneCodeHash: z.string().min(1),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SignInRespSchema } },
        description: "Sign-in result",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const args = c.req.valid("json");
    try {
      const r = await tgSignIn(helpers(wsId), args);
      if (r.kind === "user_not_found")
        return c.json({ status: "user_not_found" as const });
      if (r.kind === "password_needed")
        return c.json({ status: "password_needed" as const });
      if (r.kind === "phone_code_invalid")
        return c.json({ status: "phone_code_invalid" as const });
      const acc = await afterAuth(wsId, userId, r.client);
      return c.json({
        status: "sign_in_complete" as const,
        accountId: acc.id,
      });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/auth/sign-in-password",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ password: z.string().min(1).max(256) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: SignInPasswordRespSchema },
        },
        description: "Password check result",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { password } = c.req.valid("json");
    try {
      const r = await tgSignInPassword(helpers(wsId), password);
      if (r.kind === "password_invalid")
        return c.json({ status: "password_invalid" as const });
      const acc = await afterAuth(wsId, userId, r.client);
      return c.json({
        status: "sign_in_complete" as const,
        accountId: acc.id,
      });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.get(
  "/v1/workspaces/:wsId/outreach/accounts/auth/qr-stream",
  (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    return streamQrState(
      c,
      qrKey.outreach(wsId),
      async () => {
        const r = await tgReadQrState(
          helpers(wsId),
          apiId,
          apiHash,
          (client) => afterAuth(wsId, userId, client),
        );
        if (r.status === "success") {
          return { status: "success" as const, accountId: r.data.id };
        }
        return r;
      },
      (s) => s.status !== "scan-qr-code",
    );
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
    tags: ["outreach"],
    request: { params: WsAccountParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("param");
    const ok = await deleteOutreachAccount(wsId, accountId);
    if (!ok) throw new HTTPException(404, { message: "account not found" });
    return c.body(null, 204);
  },
);

// Финал auth: getMe → persist (dedup по uniq workspace+tg_user_id), чистим pending.
async function afterAuth(
  workspaceId: string,
  userId: string,
  client: TelegramClient,
): Promise<{ id: string }> {
  const user = (await client.getMe()) as Api.User;
  const acc = await persistOutreachAccount(workspaceId, userId, client, {
    tgUserId: String(user.id),
    tgUsername: pickActiveUsername(user),
    phoneNumber: user.phone ?? null,
    firstName: user.firstName ?? null,
    hasPremium: !!user.premium,
  });
  await clearPendingOutreachClient(workspaceId);
  return acc;
}

export default app;

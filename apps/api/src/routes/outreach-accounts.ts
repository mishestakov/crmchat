import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  outreachAccountPlatform,
  outreachAccountStatus,
  properties as propsTable,
  tgChats,
  tgUsers,
  workspaceMembers,
} from "../db/schema.ts";
import { errMsg } from "../lib/errors.ts";
import {
  clearPendingOutreachClient,
  deleteOutreachAccount,
  getOrCreatePendingOutreachClient,
  persistOutreachAccount,
} from "../lib/outreach-account-client.ts";
import {
  maxSendCode,
  maxSignInCode,
  maxSignInPassword,
  persistMaxAccount,
} from "../lib/max-account-client.ts";
import {
  accountAccessClause,
  assertAccountAccess,
} from "../lib/outreach-access.ts";
import {
  streamAuthState,
  tdRequestQr,
  tdSendCode,
  tdSignInCode,
  tdSignInPassword,
  type AuthState,
} from "../lib/tdlib/index.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// Outreach-аккаунты: ОТПРАВЛЯЮЩИЕ TG-аккаунты для холодных рассылок (multi per
// workspace). Auth-флоу через TDLib state-machine: HTTP-ручки вызывают
// нужные методы (sendCode/signIn/signInPassword/qr), а UI следит за прогрессом
// через SSE qr-stream, который мапит updateAuthorizationState в дискретные
// state'ы.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsAccountParam = z.object({
  wsId: z.string().min(1).max(64),
  accountId: z.string().min(1).max(64),
});

const AccountSchema = z
  .object({
    id: z.string(),
    platform: z.enum(outreachAccountPlatform.enumValues),
    status: z.enum(outreachAccountStatus.enumValues),
    tgUserId: z.string(),
    tgUsername: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    firstName: z.string().nullable(),
    hasPremium: z.boolean(),
    newLeadsDailyLimit: z.number().int(),
    // FloodWait cooldown — если set, аккаунт молчит до этой даты. Worker и
    // quick-send пропускают/блокируют отправку, UI рисует countdown.
    cooldownUntil: z.iso.datetime().nullable(),
    cooldownReason: z.string().nullable(),
    ownerUserId: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("OutreachAccount");

const TransferAccountBody = z
  .object({
    newOwnerUserId: z.string().min(1).max(64),
  })
  .openapi("TransferOutreachAccount");

const PatchAccountBody = z
  .object({
    newLeadsDailyLimit: z.number().int().min(0).max(1000).optional(),
  })
  .openapi("PatchOutreachAccount");

const ImportContactsRespSchema = z
  .object({
    imported: z.number().int(),
    skipped: z.number().int(),
    // Сколько диалогов сейчас в реплике (tg_chats) — фронт сравнивает между
    // последовательными вызовами: пока растёт, bootstrap ещё идёт, повторяем.
    replicaSize: z.number().int(),
  })
  .openapi("ImportContactsResp");

function serializeAccount(r: typeof outreachAccounts.$inferSelect) {
  return {
    id: r.id,
    platform: r.platform,
    status: r.status,
    tgUserId: r.externalUserId,
    tgUsername: r.externalUsername,
    phoneNumber: r.phoneNumber,
    firstName: r.firstName,
    hasPremium: r.hasPremium,
    newLeadsDailyLimit: r.newLeadsDailyLimit,
    cooldownUntil: r.cooldownUntil?.toISOString() ?? null,
    cooldownReason: r.cooldownReason,
    ownerUserId: r.ownerUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

const SendCodeRespSchema = z.object({
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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const rows = await db
      .select()
      .from(outreachAccounts)
      .where(accountAccessClause(wsId, userId, role))
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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    const row = await assertAccountAccess(accountId, wsId, userId, role);
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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    const body = c.req.valid("json");
    await assertAccountAccess(accountId, wsId, userId, role);
    const [row] = await db
      .update(outreachAccounts)
      .set({
        newLeadsDailyLimit: body.newLeadsDailyLimit,
        updatedAt: new Date(),
      })
      .where(eq(outreachAccounts.id, accountId))
      .returning();
    if (!row) throw new HTTPException(404, { message: "account not found" });
    return c.json(serializeAccount(row));
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
            schema: z.object({
              phoneNumber: z.string().min(5).max(32),
              platform: z.enum(outreachAccountPlatform.enumValues).default("telegram"),
            }),
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
    const { phoneNumber, platform } = c.req.valid("json");
    try {
      if (platform === "max") {
        await maxSendCode(wsId, phoneNumber);
        // MAX всегда шлёт SMS — фронту это маппится в isCodeViaApp=false.
        return c.json({ isCodeViaApp: false });
      }
      // Свежий клиент: предыдущая попытка могла оставить устаревший phone-state.
      await clearPendingOutreachClient(wsId);
      const pending = await getOrCreatePendingOutreachClient(wsId);
      const r = await tdSendCode(pending, phoneNumber);
      return c.json(r);
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
              phoneCode: z.string().min(1).max(16),
              platform: z.enum(outreachAccountPlatform.enumValues).default("telegram"),
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
    const { phoneCode, platform } = c.req.valid("json");
    try {
      if (platform === "max") {
        const r = await maxSignInCode(wsId, phoneCode);
        if (r.kind === "password_needed")
          return c.json({ status: "password_needed" as const });
        if (r.kind === "code_invalid")
          return c.json({ status: "phone_code_invalid" as const });
        const acc = await persistMaxAccount(wsId, userId);
        return c.json({ status: "sign_in_complete" as const, accountId: acc.id });
      }
      const pending = await getOrCreatePendingOutreachClient(wsId);
      const r = await tdSignInCode(pending, phoneCode);
      if (r.kind === "user_not_found")
        return c.json({ status: "user_not_found" as const });
      if (r.kind === "password_needed")
        return c.json({ status: "password_needed" as const });
      if (r.kind === "phone_code_invalid")
        return c.json({ status: "phone_code_invalid" as const });
      const acc = await persistOutreachAccount(wsId, userId, pending);
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
            schema: z.object({
              password: z.string().min(1).max(256),
              platform: z.enum(outreachAccountPlatform.enumValues).default("telegram"),
            }),
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
    const { password, platform } = c.req.valid("json");
    try {
      if (platform === "max") {
        const r = await maxSignInPassword(wsId, password);
        if (r.kind === "password_invalid")
          return c.json({ status: "password_invalid" as const });
        const acc = await persistMaxAccount(wsId, userId);
        return c.json({ status: "sign_in_complete" as const, accountId: acc.id });
      }
      const pending = await getOrCreatePendingOutreachClient(wsId);
      const r = await tdSignInPassword(pending, password);
      if (r.kind === "password_invalid")
        return c.json({ status: "password_invalid" as const });
      const acc = await persistOutreachAccount(wsId, userId, pending);
      return c.json({
        status: "sign_in_complete" as const,
        accountId: acc.id,
      });
    } catch (e) {
      throw new HTTPException(400, { message: errMsg(e) });
    }
  },
);

app.get("/v1/workspaces/:wsId/outreach/accounts/auth/qr-stream", async (c) => {
  const wsId = c.get("workspaceId");
  const userId = c.get("userId");
  // Свежий pending-клиент для QR-флоу, и сразу invoke requestQrCodeAuthentication
  // — TDLib ответит updateAuthorizationStateWaitOtherDeviceConfirmation с link'ом,
  // который streamAuthState прочитает из current().
  await clearPendingOutreachClient(wsId);
  const pending = await getOrCreatePendingOutreachClient(wsId);
  await tdRequestQr(pending);

  type QrState =
    | { status: "scan-qr-code"; token: string }
    | { status: "password_needed" }
    | { status: "success"; accountId: string }
    | { status: "error"; message: string };

  // success-ветку обрабатываем ровно один раз (persist + clear pending).
  let persisted: { id: string } | null = null;
  let errored: string | null = null;

  const read = async (): Promise<QrState> => {
    if (persisted) return { status: "success", accountId: persisted.id };
    if (errored) return { status: "error", message: errored };
    const s: AuthState = pending.authBus.current();
    if (s.kind === "wait_qr") return { status: "scan-qr-code", token: s.link };
    if (s.kind === "wait_password") return { status: "password_needed" };
    if (s.kind === "ready") {
      try {
        persisted = await persistOutreachAccount(wsId, userId, pending);
        return { status: "success", accountId: persisted.id };
      } catch (e) {
        errored = errMsg(e);
        return { status: "error", message: errored };
      }
    }
    // wait_phone_or_qr / wait_tdlib_parameters — скрываем за scan-qr-code,
    // фронт ждёт нашего link'а и не паникует.
    return { status: "scan-qr-code", token: "" };
  };

  return streamAuthState(c, pending.authBus, read, (s) => {
    return s.status === "success" || s.status === "password_needed" || s.status === "error";
  });
});

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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    await assertAccountAccess(accountId, wsId, userId, role);
    const ok = await deleteOutreachAccount(wsId, accountId);
    if (!ok) throw new HTTPException(404, { message: "account not found" });
    return c.body(null, 204);
  },
);

// Прогресс bootstrap'а реплики (этап 16.9 ревизия — БЕЗ дампа в контакты).
// Возвращает replicaSize = сколько личных диалогов аккаунта сейчас в tg_chats
// (без Saved Messages и удалённых). Фронт поллит на онбординге: пока растёт —
// чат-лист ещё догружается. Контакты из диалогов НЕ заводим (личное не утекает
// в общий список) — они появляются осознанно: привязка админа/группы или матч
// при CSV-импорте.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/import-contacts",
    tags: ["outreach"],
    request: { params: WsAccountParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: ImportContactsRespSchema },
        },
        description: "Imported peers from account's DM list into contacts",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    const acc = await assertAccountAccess(accountId, wsId, userId, role);

    // Дамп диалогов в общие контакты УБРАН (этап 16.9 ревизия): личные
    // переписки менеджера больше не утекают в общий список воркспейса. Эндпоинт
    // теперь только репортит размер реплики (прогресс bootstrap'а чат-листа для
    // онбординга). Контакты заводятся ОСОЗНАННО — привязкой админа/группы или
    // матчем при CSV-импорте; «кто с кем общался» читается из tg_chats live.
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tgChats)
      .innerJoin(tgUsers, eq(tgUsers.userId, tgChats.peerUserId))
      .where(
        and(
          eq(tgChats.accountId, accountId),
          eq(tgUsers.isDeleted, false),
          sql`${tgChats.peerUserId} != ${acc.externalUserId}`,
        ),
      );

    return c.json({ imported: 0, skipped: 0, replicaSize: row?.n ?? 0 });
  },
);

// Меняет owner_user_id; делегации остаются. Только admin.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/transfer",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsAccountParam,
      body: {
        content: { "application/json": { schema: TransferAccountBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: AccountSchema } },
        description: "Owner transferred",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId } = c.req.valid("param");
    const { newOwnerUserId } = c.req.valid("json");
    // newOwnerUserId должен быть членом workspace'а — иначе нарушим
    // tenancy. Проверяем JOIN'ом на workspace_members.
    const [member] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, newOwnerUserId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new HTTPException(400, {
        message: "newOwnerUserId is not a member of this workspace",
      });
    }
    const [row] = await db
      .update(outreachAccounts)
      .set({ ownerUserId: newOwnerUserId, updatedAt: new Date() })
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

export default app;

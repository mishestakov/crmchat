import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  outreachAccountStatus,
  properties as propsTable,
  tgChats,
  tgUsers,
  workspaceMembers,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "../lib/contact-sql.ts";
import { errMsg } from "../lib/errors.ts";
import { resolveStickyByPeerIds } from "../lib/sticky.ts";
import {
  clearPendingOutreachClient,
  deleteOutreachAccount,
  getOrCreatePendingOutreachClient,
  persistOutreachAccount,
} from "../lib/outreach-account-client.ts";
import {
  accountAccessClause,
  assertAccountAccess,
} from "../lib/outreach-access.ts";
import { tryDecrypt } from "../lib/crypto.ts";
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

// TWA session: { mainDcId, keys: { [dcId]: hexAuthKey } } — формат, который
// принимает apps/tg-client. Получается через TDLib getMtprotoSession patch
// (см. tools/tdlib/patches/0001-add-mtproto-extensions.patch).
const TwaSessionResponseSchema = z
  .object({
    session: z.object({
      mainDcId: z.number().int(),
      keys: z.record(z.string(), z.string()),
      isTest: z.literal(true).optional(),
    }),
  })
  .openapi("TwaSessionResponse");

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
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    const row = await assertAccountAccess(accountId, wsId, userId, role);
    if (!row.iframeSession) {
      throw new HTTPException(409, {
        message: "iframe session unavailable, re-auth required",
      });
    }

    const decoded = tryDecrypt(row.iframeSession);
    if (!decoded) {
      throw new HTTPException(409, {
        message: "iframe session corrupted, re-auth required",
      });
    }
    let session: { mainDcId: number; keys: Record<number, string> };
    try {
      session = JSON.parse(decoded);
    } catch (e) {
      console.error(`[twa-session] parse failed for ${accountId}:`, errMsg(e));
      throw new HTTPException(409, {
        message: "iframe session malformed, re-auth required",
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
    const { phoneCode } = c.req.valid("json");
    try {
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

// Перманентная передача аккаунта другому менеджеру (увольнение, реорг).
// Импорт собеседников аккаунта в contacts. Источник — локальная реплика
// (tg_chats × tg_users), поэтому offline и быстро. Дедуп через partial unique
// index по (workspace_id, properties->>'tg_user_id'). Skip: Saved Messages
// (peer == self) и удалённые TG-юзеры (is_deleted=true). Боты в реплику
// не пишутся репликатором (см. tg-replicator.ts:botPeers), поэтому отдельной
// фильтрации тут нет.
//
// Идемпотентно: повторный вызов докинет только новые DM. Фронт это эксплуатит
// для polling'а во время bootstrap'а реплики на свежем аккаунте.
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

    const baseFilter = and(
      eq(tgChats.accountId, accountId),
      eq(tgUsers.isDeleted, false),
      sql`${tgChats.peerUserId} != ${acc.tgUserId}`,
    );

    // Без LIMIT: продуктовый потолок ~2k чатов на аккаунт; SELECT JOIN на
    // эту шкалу — десятки KB ответ, INSERT'у contacts — единицы тысяч строк
    // с десятком тысяч bind-параметров (под Postgres-лимитом 32k). Polling
    // на фронте по стабилизации replicaSize безопасен против повторов.
    const candidates = await db
      .select({
        peerUserId: tgChats.peerUserId,
        fullName: tgUsers.fullName,
        username: tgUsers.username,
        phone: tgUsers.phone,
        lastMessageAt: tgChats.lastMessageAt,
      })
      .from(tgChats)
      .innerJoin(tgUsers, eq(tgUsers.userId, tgChats.peerUserId))
      .where(baseFilter)
      .orderBy(sql`${tgChats.lastMessageAt} desc nulls last`);

    const replicaSize = candidates.length;

    if (candidates.length === 0) {
      return c.json({ imported: 0, skipped: 0, replicaSize });
    }

    const peerIds = candidates.map((c) => c.peerUserId);

    // Sticky v2: двухуровневый резолвер (см. lib/sticky.ts). Уровень 1 —
    // MAX(last_inbound_at), уровень 2 — fallback по has_inbound с MAX
    // last_message_at. Если ни один уровень не сработал — sticky null,
    // в задаче пойдёт через round-robin.
    const winnerByPeer = await resolveStickyByPeerIds(wsId, peerIds);

    // Стейдж не проставляем: контакт в базе ≠ лид-в-задаче.
    const rows = candidates.map((cand) => {
      const properties: Record<string, unknown> = {
        tg_user_id: cand.peerUserId,
        full_name: cand.fullName || cand.username || "Без имени",
      };
      if (cand.username) properties.telegram_username = cand.username;
      if (cand.phone) properties.phone = cand.phone;
      return {
        workspaceId: wsId,
        createdBy: userId,
        lastMessageAt: cand.lastMessageAt,
        primaryAccountId: winnerByPeer.get(cand.peerUserId) ?? null,
        properties,
      };
    });

    const inserted = await db
      .insert(contacts)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: contacts.id });

    // Существующим контактам с NULL-sticky проставляем winner'а
    // (если таковой есть). Группируем peer'ов по аккаунту-победителю —
    // один UPDATE на каждый аккаунт.
    const byWinnerAccount = new Map<string, string[]>();
    for (const [peer, acc] of winnerByPeer) {
      const list = byWinnerAccount.get(acc) ?? [];
      list.push(peer);
      byWinnerAccount.set(acc, list);
    }
    for (const [acc, peers] of byWinnerAccount) {
      await db
        .update(contacts)
        .set({ primaryAccountId: acc })
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            isNull(contacts.primaryAccountId),
            inArray(contactTgUserIdSql, peers),
          ),
        );
    }

    return c.json({
      imported: inserted.length,
      skipped: candidates.length - inserted.length,
      replicaSize,
    });
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

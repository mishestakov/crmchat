import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client";
import {
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
} from "../db/schema";
import {
  assertRole,
  type WorkspaceVars,
} from "../middleware/assert-member";
import type { SessionVars } from "../middleware/require-session";

const INVITE_TTL_DAYS = 7;
const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

// Публичный токен инвайта в URL /accept-invite/{wsId}/{code}. 32 байта
// base64url ≈ 256 бит — не угадывается. crypto.getRandomValues, не
// Math.random.
function newInviteCode(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}

const WsIdParam = z.object({ wsId: z.string().min(1).max(64) });
const InviteIdParam = WsIdParam.extend({
  inviteId: z.string().min(1).max(64),
});
const CodeParam = z.object({ code: z.string().min(1).max(128) });

const RoleSchema = z.enum(["admin", "member"]);

const InviteSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    telegramUsername: z.string(),
    role: RoleSchema,
    code: z.string(),
    createdBy: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
  })
  .openapi("WorkspaceInvite");

type InviteRow = typeof workspaceInvites.$inferSelect;

function serializeInvite(row: InviteRow): z.infer<typeof InviteSchema> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    telegramUsername: row.telegramUsername,
    role: row.role,
    code: row.code,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

// admin-scoped — workspace-CRUD над приглашениями. Подключается под
// requireSession + assertMember на /v1/workspaces/:wsId/* в app.ts.
export const wsInvites = new OpenAPIHono<{ Variables: WorkspaceVars }>();

wsInvites.use("/v1/workspaces/:wsId/invites", assertRole("admin"));
wsInvites.use("/v1/workspaces/:wsId/invites/*", assertRole("admin"));

wsInvites.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/invites",
    tags: ["invites"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({
              telegramUsername: z
                .string()
                .trim()
                .min(1)
                .max(64)
                .transform((v) => v.replace(/^@/, "")),
              role: RoleSchema.default("member"),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: InviteSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const wsId = c.get("workspaceId");
    const { telegramUsername, role } = c.req.valid("json");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const [row] = await db
      .insert(workspaceInvites)
      .values({
        workspaceId: wsId,
        telegramUsername,
        role,
        code: newInviteCode(),
        createdBy: userId,
        expiresAt,
      })
      .returning();
    return c.json(serializeInvite(row!), 201);
  },
);

wsInvites.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/invites",
    tags: ["invites"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(InviteSchema) } },
        description: "Pending invites",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const rows = await db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, wsId),
          isNull(workspaceInvites.acceptedAt),
          isNull(workspaceInvites.revokedAt),
          gt(workspaceInvites.expiresAt, new Date()),
        ),
      )
      .orderBy(workspaceInvites.createdAt);
    return c.json(rows.map(serializeInvite));
  },
);

wsInvites.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/invites/{inviteId}",
    tags: ["invites"],
    request: { params: InviteIdParam },
    responses: { 204: { description: "Revoked" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { inviteId } = c.req.valid("param");
    // Идемпотентно: если row не было / уже принят / уже отозван — всё равно
    // 204. С точки зрения админа исход одинаковый: «pending больше не
    // существует».
    await db
      .update(workspaceInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(workspaceInvites.id, inviteId),
          eq(workspaceInvites.workspaceId, wsId),
          isNull(workspaceInvites.acceptedAt),
          isNull(workspaceInvites.revokedAt),
        ),
      );
    return c.body(null, 204);
  },
);

// Открытые роуты — только requireSession (любой залогиненный).
// /v1/invites/:code GET и /v1/invites/:code/accept POST.
export const publicInvites = new OpenAPIHono<{ Variables: SessionVars }>();

const PublicInviteSchema = z
  .object({
    workspaceId: z.string(),
    workspaceName: z.string(),
    role: RoleSchema,
    invitedByName: z.string().nullable(),
    telegramUsername: z.string(),
    expiresAt: z.string(),
    alreadyMember: z.boolean(),
  })
  .openapi("PublicInvite");

publicInvites.openapi(
  createRoute({
    method: "get",
    path: "/v1/invites/{code}",
    tags: ["invites"],
    request: { params: CodeParam },
    responses: {
      200: {
        content: { "application/json": { schema: PublicInviteSchema } },
        description: "Invite preview",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { code } = c.req.valid("param");
    const [invite] = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.code, code))
      .limit(1);
    if (
      !invite ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= Date.now()
    ) {
      throw new HTTPException(404, { message: "invite not found or expired" });
    }
    const [existing] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, invite.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    // Если invite уже принят, отдаём 404 ВСЕМ кроме того, кто его принял
    // (он — member workspace'а). Это даёт идемпотентность UI: юзер открыл ту
    // же ссылку повторно → видит «вы уже в команде» (alreadyMember=true) →
    // accept-страница молча редиректит в /w/{wsId}/contacts.
    if (invite.acceptedAt && !existing) {
      throw new HTTPException(404, { message: "invite not found or expired" });
    }
    const [ws] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invite.workspaceId))
      .limit(1);
    if (!ws) {
      throw new HTTPException(404, { message: "workspace not found" });
    }
    const [inviter] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, invite.createdBy))
      .limit(1);
    return c.json({
      workspaceId: invite.workspaceId,
      workspaceName: ws.name,
      role: invite.role,
      invitedByName: inviter?.name ?? null,
      telegramUsername: invite.telegramUsername,
      expiresAt: invite.expiresAt.toISOString(),
      alreadyMember: existing != null,
    });
  },
);

publicInvites.openapi(
  createRoute({
    method: "post",
    path: "/v1/invites/{code}/accept",
    tags: ["invites"],
    request: { params: CodeParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ workspaceId: z.string() }),
          },
        },
        description: "Accepted",
      },
    },
  }),
  async (c) => {
    const userId = c.get("userId");
    const { code } = c.req.valid("param");
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.code, code))
        .limit(1);
      if (
        !invite ||
        invite.revokedAt ||
        invite.expiresAt.getTime() <= Date.now()
      ) {
        throw new HTTPException(404, { message: "invite not found or expired" });
      }
      // Идемпотентность: если уже member — просто возвращаем wsId без
      // повторного INSERT и без переписывания acceptedAt. Иначе двойной клик
      // «Принять» смог бы понизить пользователя из admin в member-роль
      // инвайта.
      const [existing] = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!existing) {
        await tx.insert(workspaceMembers).values({
          workspaceId: invite.workspaceId,
          userId,
          role: invite.role,
        });
      }
      // acceptedAt ставим на первом успешном accept; повторный — noop.
      if (!invite.acceptedAt) {
        await tx
          .update(workspaceInvites)
          .set({ acceptedAt: new Date() })
          .where(eq(workspaceInvites.id, invite.id));
      }
      return { workspaceId: invite.workspaceId };
    });
    return c.json(result);
  },
);

// Удаление участника / leave-self. Под /v1/workspaces/:wsId/* (assertMember).
// Логика:
//   - other admin/member может удалить любого, кроме себя — только если он admin.
//   - себя может удалить любой member.
//   - если удаляемый — admin, и он последний admin → 409 (для self и для other).
//     Чтобы избавиться от ws, admin должен либо повысить кого-то, либо
//     вызвать DELETE /v1/workspaces/{wsId} (см. workspaces.ts).
export const memberOps = new OpenAPIHono<{ Variables: WorkspaceVars }>();

memberOps.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/members/{userId}",
    tags: ["members"],
    request: {
      params: z.object({
        wsId: z.string().min(1).max(64),
        userId: z.string().min(1).max(64),
      }),
    },
    responses: {
      204: { description: "Removed" },
      409: { description: "Last admin cannot leave" },
    },
  }),
  async (c) => {
    const meId = c.get("userId");
    const myRole = c.get("workspaceRole");
    const wsId = c.get("workspaceId");
    const { userId: targetId } = c.req.valid("param");
    const isSelf = targetId === meId;
    if (!isSelf && myRole !== "admin") {
      throw new HTTPException(403, { message: "admin role required" });
    }
    const [target] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new HTTPException(404, { message: "member not found" });
    }
    if (target.role === "admin") {
      const adminRows = await db
        .select({ adminCount: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, wsId),
            eq(workspaceMembers.role, "admin"),
          ),
        );
      const adminCount = adminRows[0]?.adminCount ?? 0;
      if (adminCount <= 1) {
        throw new HTTPException(409, {
          message: isSelf
            ? "you are the last admin: promote someone to admin or delete the workspace"
            : "cannot remove the last admin: promote someone first or delete the workspace",
        });
      }
    }
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, targetId),
        ),
      );
    return c.body(null, 204);
  },
);

// PATCH /v1/workspaces/:wsId/members/:userId — смена роли. Admin-only.
// Запрещаем менять собственную роль (consistency с UI hint
// «cannotChangeOwnRole»). При понижении последнего admin'а → 409.
memberOps.use(
  "/v1/workspaces/:wsId/members/:userId",
  // Note: middleware применится для всех методов на этом пути; для DELETE-выше
  // role-проверка дублируется внутри handler'а — там логика «self vs other»
  // тонкая. Для PATCH — admin-only, см. ниже.
  async (c, next) => {
    if (c.req.method === "PATCH") {
      if (c.get("workspaceRole") !== "admin") {
        throw new HTTPException(403, { message: "admin role required" });
      }
    }
    await next();
  },
);

memberOps.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/members/{userId}",
    tags: ["members"],
    request: {
      params: z.object({
        wsId: z.string().min(1).max(64),
        userId: z.string().min(1).max(64),
      }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ role: RoleSchema }),
          },
        },
        required: true,
      },
    },
    responses: { 204: { description: "Updated" } },
  }),
  async (c) => {
    const meId = c.get("userId");
    const wsId = c.get("workspaceId");
    const { userId: targetId } = c.req.valid("param");
    const { role: newRole } = c.req.valid("json");
    if (targetId === meId) {
      throw new HTTPException(400, { message: "cannot change own role" });
    }
    const [target] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, targetId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new HTTPException(404, { message: "member not found" });
    }
    if (target.role === "admin" && newRole !== "admin") {
      const adminRows = await db
        .select({ adminCount: count() })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, wsId),
            eq(workspaceMembers.role, "admin"),
          ),
        );
      const adminCount = adminRows[0]?.adminCount ?? 0;
      if (adminCount <= 1) {
        throw new HTTPException(409, {
          message: "cannot demote the last admin",
        });
      }
    }
    await db
      .update(workspaceMembers)
      .set({ role: newRole })
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, targetId),
        ),
      );
    return c.body(null, 204);
  },
);


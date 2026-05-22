import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  outreachAccountDelegations,
  outreachAccounts,
  users,
  workspaceMembers,
} from "../db/schema.ts";
import {
  assertRole,
  type WorkspaceVars,
} from "../middleware/assert-member.ts";
import { assertAccountAccess } from "../lib/outreach-access.ts";

// Делегация outreach-аккаунта: временная передача доступа (отпуск,
// больничный). Owner НЕ меняется. Окончание автоматическое по дате;
// досрочный отзыв = UPDATE ends_at = now() (soft-cancel, чтобы прошлая
// делегация осталась в истории).
//
// CRUD admin-only. View — открыт через assertAccountAccess (admin видит всё;
// member видит только если у него уже есть доступ к аккаунту — иначе
// нечего смотреть).

const WsAccountParam = z.object({
  wsId: z.string().min(1).max(64),
  accountId: z.string().min(1).max(64),
});

const WsAccountDelegateParam = WsAccountParam.extend({
  delegateId: z.string().min(1).max(64),
});

const DelegateUserSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable(),
    username: z.string().nullable(),
  })
  .openapi("DelegateUser");

const DelegationSchema = z
  .object({
    accountId: z.string(),
    delegateId: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    // Обогащение для UI: имя/username делегата (без отдельного запроса
    // на /members при рендере карточки аккаунта).
    delegate: DelegateUserSchema.nullable(),
  })
  .openapi("OutreachAccountDelegation");

const CreateDelegationBody = z
  .object({
    delegateId: z.string().min(1).max(64),
    // Default = now() на сервере, если не передано.
    startsAt: z.iso.datetime().optional(),
    // null = бессрочно.
    endsAt: z.iso.datetime().nullable().optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .openapi("CreateOutreachAccountDelegation");

type DelegationRow = typeof outreachAccountDelegations.$inferSelect;
type UserPick = { id: string; name: string | null; username: string | null };

function serialize(
  row: DelegationRow,
  delegate: UserPick | null,
): z.infer<typeof DelegationSchema> {
  return {
    accountId: row.accountId,
    delegateId: row.delegateId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    delegate,
  };
}

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// === GET /v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations ===
// Список делегаций аккаунта (активные / будущие / прошлые), DESC по starts_at.
// Видимость: assertAccountAccess (admin — всегда; member — если есть доступ).
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations",
    tags: ["outreach"],
    request: { params: WsAccountParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ items: z.array(DelegationSchema) }),
          },
        },
        description: "OK",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { accountId } = c.req.valid("param");
    await assertAccountAccess(accountId, wsId, userId, role);

    const rows = await db
      .select({
        d: outreachAccountDelegations,
        u: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
      .from(outreachAccountDelegations)
      .leftJoin(users, eq(users.id, outreachAccountDelegations.delegateId))
      .where(eq(outreachAccountDelegations.accountId, accountId))
      .orderBy(desc(outreachAccountDelegations.startsAt));

    return c.json({
      items: rows.map((r) => serialize(r.d, r.u as UserPick | null)),
    });
  },
);

// === POST /v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations ===
// Admin-only. Создать делегацию. startsAt default = now(); endsAt null =
// бессрочно. delegateId должен быть member'ом workspace'а — иначе нарушим
// tenancy (member, которому передали, должен иметь доступ в WS).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsAccountParam,
      body: {
        content: { "application/json": { schema: CreateDelegationBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: DelegationSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const createdBy = c.get("userId");
    const { accountId } = c.req.valid("param");
    const { delegateId, startsAt, endsAt, reason } = c.req.valid("json");

    // Аккаунт принадлежит этому workspace'у?
    const [acc] = await db
      .select({ ownerUserId: outreachAccounts.ownerUserId })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!acc) throw new HTTPException(404, { message: "account not found" });

    // Делегат — member этого workspace'а. Owner'у делегировать его же
    // аккаунт бессмысленно: он и так видит, и резолвер вернёт true ещё
    // до проверки делегации.
    if (delegateId === acc.ownerUserId) {
      throw new HTTPException(400, {
        message: "delegateId is the current owner",
      });
    }
    const [member] = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, wsId),
          eq(workspaceMembers.userId, delegateId),
        ),
      )
      .limit(1);
    if (!member) {
      throw new HTTPException(400, {
        message: "delegateId is not a member of this workspace",
      });
    }

    const starts = startsAt ? new Date(startsAt) : new Date();
    const ends = endsAt === undefined || endsAt === null ? null : new Date(endsAt);
    if (ends !== null && ends <= starts) {
      throw new HTTPException(400, {
        message: "endsAt must be after startsAt",
      });
    }

    const [row] = await db
      .insert(outreachAccountDelegations)
      .values({
        accountId,
        delegateId,
        startsAt: starts,
        endsAt: ends,
        reason: reason ?? null,
        createdBy,
      })
      .returning();

    const [u] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, delegateId))
      .limit(1);

    return c.json(serialize(row!, u ?? null), 201);
  },
);

// === DELETE /v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations/{delegateId}?startsAt=iso ===
// Admin-only. Поведение в зависимости от текущего момента:
//   now() < starts_at         → hard DELETE (будущая делегация, ничего не
//                              началось, истории сохранять нечего).
//   starts_at <= now()         → soft-cancel: UPDATE ends_at = now().
//                              Если ends_at уже прошёл — 404 «already ended».
// startsAt в querystring (а не в path) — частичный PK через path-сегмент
// требует percent-encoded ISO с двоеточиями, UX'но грязно.
app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/outreach/accounts/{accountId}/delegations/{delegateId}",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsAccountDelegateParam,
      query: z.object({ startsAt: z.iso.datetime() }),
    },
    responses: {
      204: { description: "Cancelled or deleted" },
      404: { description: "Delegation not found or already ended" },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { accountId, delegateId } = c.req.valid("param");
    const { startsAt } = c.req.valid("query");

    // Аккаунт принадлежит ws — иначе можно через чужой accountId стереть
    // делегацию на чужом ws.
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!acc) throw new HTTPException(404, { message: "account not found" });

    const starts = new Date(startsAt);
    const [row] = await db
      .select()
      .from(outreachAccountDelegations)
      .where(
        and(
          eq(outreachAccountDelegations.accountId, accountId),
          eq(outreachAccountDelegations.delegateId, delegateId),
          eq(outreachAccountDelegations.startsAt, starts),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "delegation not found" });

    const now = new Date();
    if (now < row.startsAt) {
      await db
        .delete(outreachAccountDelegations)
        .where(
          and(
            eq(outreachAccountDelegations.accountId, accountId),
            eq(outreachAccountDelegations.delegateId, delegateId),
            eq(outreachAccountDelegations.startsAt, starts),
          ),
        );
      return c.body(null, 204);
    }
    if (row.endsAt !== null && row.endsAt <= now) {
      throw new HTTPException(404, { message: "delegation already ended" });
    }
    await db
      .update(outreachAccountDelegations)
      .set({ endsAt: now })
      .where(
        and(
          eq(outreachAccountDelegations.accountId, accountId),
          eq(outreachAccountDelegations.delegateId, delegateId),
          eq(outreachAccountDelegations.startsAt, starts),
        ),
      );
    return c.body(null, 204);
  },
);

// === GET /v1/workspaces/{wsId}/outreach/delegations?delegateId=&active=true ===
// Удобный list поверх ws: «делегации мне» (для бейджа в шапке member'а) или
// «активные делегации сотрудника X» (admin перед увольнением).
// Member может фильтровать только по себе; admin — по любому userId.
// active=true → only WHERE now ∈ [starts_at, ends_at).
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/outreach/delegations",
    tags: ["outreach"],
    request: {
      params: z.object({ wsId: z.string().min(1).max(64) }),
      query: z.object({
        delegateId: z.string().min(1).max(64).optional(),
        active: z
          .union([z.literal("true"), z.literal("false")])
          .optional()
          .transform((v) => v === "true"),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ items: z.array(DelegationSchema) }),
          },
        },
        description: "OK",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { delegateId, active } = c.req.valid("query");

    if (role !== "admin") {
      // Member может смотреть только свои делегации. Если запросил чужие —
      // 403 (не 404: запрос явно про чужого юзера, скрывать нечего).
      if (delegateId && delegateId !== userId) {
        throw new HTTPException(403, { message: "admin role required" });
      }
    }
    const effectiveDelegateId =
      role === "admin" ? delegateId : (delegateId ?? userId);

    const filters = [eq(outreachAccounts.workspaceId, wsId)];
    if (effectiveDelegateId) {
      filters.push(
        eq(outreachAccountDelegations.delegateId, effectiveDelegateId),
      );
    }
    if (active) {
      filters.push(lt(outreachAccountDelegations.startsAt, sql`now()`));
      filters.push(
        or(
          // endsAt IS NULL — бессрочно
          sql`${outreachAccountDelegations.endsAt} IS NULL`,
          gt(outreachAccountDelegations.endsAt, sql`now()`),
        )!,
      );
    }
    const rows = await db
      .select({
        d: outreachAccountDelegations,
        u: {
          id: users.id,
          name: users.name,
          username: users.username,
        },
      })
      .from(outreachAccountDelegations)
      .innerJoin(
        outreachAccounts,
        eq(outreachAccounts.id, outreachAccountDelegations.accountId),
      )
      .leftJoin(users, eq(users.id, outreachAccountDelegations.delegateId))
      .where(and(...filters))
      .orderBy(desc(outreachAccountDelegations.startsAt));

    return c.json({
      items: rows.map((r) => serialize(r.d, r.u as UserPick | null)),
    });
  },
);

export default app;

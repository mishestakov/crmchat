import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  outreachAccountDelegations,
  outreachAccounts,
  projects,
  workspaceMembers,
} from "../db/schema.ts";
import {
  assertRole,
  type WorkspaceVars,
} from "../middleware/assert-member.ts";

// «Уволить» member'а: одной транзакцией перевести все его outreach-аккаунты на
// новых владельцев, отозвать все его делегации (inbound — где он delegate; и
// outbound — на ВСЕ его аккаунты, потому что они меняют владельца и текущие
// «он подменяет коллегу» теряют смысл — wait, нет: «подменяет коллегу» это
// его delegate_id, а аккаунты у него СВОИ; «outbound» в смысле «делегации НА
// его аккаунты другим людям» — оставляем, т.к. новый owner может захотеть их
// сохранить; их удаление — отдельный шаг через UI). И удаляем из
// workspace_members.
//
// Pre-condition: body.transfers покрывает ВСЕ его аккаунты ровно по одному
// разу — иначе 400. Это страховка от гонок (между показом мастера и нажатием
// «Уволить» admin мог добавить аккаунт владельцем target'а).

const Param = z.object({
  wsId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
});

const TransferItem = z.object({
  accountId: z.string().min(1).max(64),
  newOwnerUserId: z.string().min(1).max(64),
});

const Body = z
  .object({
    transfers: z.array(TransferItem),
  })
  .openapi("DismissMemberBody");

const Resp = z
  .object({
    transferredAccountIds: z.array(z.string()),
    revokedDelegations: z.number().int(),
  })
  .openapi("DismissMemberResp");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/members/{userId}/dismiss",
    tags: ["members"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: Param,
      body: {
        content: { "application/json": { schema: Body } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: Resp } },
        description: "Member dismissed",
      },
      400: { description: "Bad transfers (missing/extra/invalid)" },
      409: { description: "Last admin cannot be dismissed" },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const meId = c.get("userId");
    const { userId: targetId } = c.req.valid("param");
    const { transfers } = c.req.valid("json");

    if (targetId === meId) {
      throw new HTTPException(400, {
        message: "cannot dismiss yourself: use leave workspace instead",
      });
    }

    // Target — реально member ws?
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

    // Last-admin guard — симметрично DELETE /members/{id} в invites.ts.
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
          message:
            "cannot dismiss the last admin: promote someone first or delete the workspace",
        });
      }
    }

    // Аккаунты target'а в этом ws.
    const ownedAccounts = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          eq(outreachAccounts.ownerUserId, targetId),
        ),
      );
    const ownedIds = new Set(ownedAccounts.map((r) => r.id));
    const transferIds = new Set(transfers.map((t) => t.accountId));

    // Полное покрытие: каждый owned аккаунт упомянут ровно один раз, и нет
    // лишних accountId.
    if (
      ownedIds.size !== transfers.length ||
      transferIds.size !== transfers.length ||
      [...ownedIds].some((id) => !transferIds.has(id)) ||
      [...transferIds].some((id) => !ownedIds.has(id))
    ) {
      throw new HTTPException(400, {
        message: "transfers must cover all and only target's accounts",
        cause: {
          expected: [...ownedIds],
          got: [...transferIds],
        },
      });
    }

    // Все newOwnerUserId — члены ws, и никто не равен target'у.
    const newOwners = [...new Set(transfers.map((t) => t.newOwnerUserId))];
    if (newOwners.includes(targetId)) {
      throw new HTTPException(400, {
        message: "newOwnerUserId cannot equal the dismissed user",
      });
    }
    if (newOwners.length > 0) {
      const members = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, wsId),
            inArray(workspaceMembers.userId, newOwners),
          ),
        );
      const memberSet = new Set(members.map((m) => m.userId));
      const missing = newOwners.filter((id) => !memberSet.has(id));
      if (missing.length > 0) {
        throw new HTTPException(400, {
          message: `newOwnerUserId is not a member: ${missing.join(", ")}`,
        });
      }
    }

    let revokedDelegations = 0;

    await db.transaction(async (tx) => {
      // Bulk-transfer аккаунтов. Per-row UPDATE — список короткий
      // (≤десятки), не оптимизируем.
      for (const t of transfers) {
        await tx
          .update(outreachAccounts)
          .set({ ownerUserId: t.newOwnerUserId, updatedAt: new Date() })
          .where(
            and(
              eq(outreachAccounts.id, t.accountId),
              eq(outreachAccounts.workspaceId, wsId),
            ),
          );
      }

      // Активные и будущие делегации, где target был delegate'ом, в этом
      // workspace'е. Прошлые (ends_at <= now) НЕ трогаем — это история
      // «кто кого подменял», нужна для audit/расследований.
      const delResult = await tx.execute<{ count: number }>(sql`
        WITH deleted AS (
          DELETE FROM outreach_account_delegations d
          USING outreach_accounts a
          WHERE d.account_id = a.id
            AND a.workspace_id = ${wsId}
            AND d.delegate_id = ${targetId}
            AND (d.ends_at IS NULL OR d.ends_at > now())
          RETURNING 1
        )
        SELECT COUNT(*)::int AS count FROM deleted
      `);
      revokedDelegations = Number(delResult[0]?.count ?? 0);

      await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, wsId),
            eq(workspaceMembers.userId, targetId),
          ),
        );
    });

    return c.json({
      transferredAccountIds: transfers.map((t) => t.accountId),
      revokedDelegations,
    });
  },
);

export default app;

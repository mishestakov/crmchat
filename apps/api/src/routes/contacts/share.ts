// Публичная read-only ссылка на переписку: создание/отзыв magic-link'а на
// диалог (contact, account). Публичное чтение — в conversation-share-client.ts.
import { randomBytes } from "node:crypto";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { conversationShares } from "../../db/schema.ts";
import { assertContactAccess } from "../../lib/contacts-access.ts";
import { assertAccountAccess } from "../../lib/outreach-access.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsIdParam } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Ссылку копируют в карточку внешней CRM; смотрит любой по ссылке в read-only.

const ConversationShareSchema = z
  .object({
    token: z.string(),
    // Относительный путь — фронт добавляет origin.
    url: z.string(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ConversationShare");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/share",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ConversationShareSchema } },
        description: "Активная ссылка на переписку (создана или существующая)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    await assertContactAccess(id, wsId);
    // Публикация переписки наружу (magic-link) — действие от имени аккаунта:
    // полный доступ (owner/делегация), не только принадлежность воркспейсу.
    await assertAccountAccess(accountId, wsId, userId, c.get("workspaceRole"));

    // Идемпотентность: одна активная ссылка на (contact, account).
    const [existing] = await db
      .select()
      .from(conversationShares)
      .where(
        and(
          eq(conversationShares.contactId, id),
          eq(conversationShares.accountId, accountId),
          isNull(conversationShares.revokedAt),
        ),
      )
      .limit(1);
    if (existing) return c.json(serializeConversationShare(existing));

    const token = randomBytes(32).toString("base64url");
    const [row] = await db
      .insert(conversationShares)
      .values({
        workspaceId: wsId,
        contactId: id,
        accountId,
        token,
        createdBy: userId,
      })
      .returning();
    return c.json(serializeConversationShare(row!));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/contacts/{id}/share/revoke",
    tags: ["contacts"],
    request: {
      params: WsIdParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ accountId: z.string().min(1).max(64) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
        description: "Ссылка отозвана (или её не было)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    await assertContactAccess(id, wsId);
    await db
      .update(conversationShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(conversationShares.contactId, id),
          eq(conversationShares.accountId, accountId),
          isNull(conversationShares.revokedAt),
        ),
      );
    return c.json({ ok: true });
  },
);

function serializeConversationShare(
  row: typeof conversationShares.$inferSelect,
) {
  return {
    token: row.token,
    url: `/share/conv/${row.token}`,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;

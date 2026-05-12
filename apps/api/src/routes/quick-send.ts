import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contacts,
  outreachAccounts,
  projectItems,
  projects,
  scheduledMessages,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "../lib/contact-sql.ts";
import { errMsg } from "../lib/errors.ts";
import {
  accountCooldownUntil,
  getOutreachWorkerClient,
} from "../lib/outreach-account-client.ts";
import { emitProjectChanged } from "../lib/outreach-events.ts";
import type { WorkspaceVars } from "../middleware/assert-member.ts";

// Quick send — ручная одиночная отправка из drawer'а контакта/лида (12.4+).
// Принципиально отличается от worker'а:
//   - идёт синхронно через TDLib, результат сразу в response;
//   - НЕ подпадает под минутный гейт авто-отправки (C2);
//   - отменяет все pending scheduled_messages для этого peer'а во всех
//     активных проектах воркспейса («менеджер взял на себя коммуникацию»).
// Cooldown (FloodWait) проверяется и блокирует отправку — выдаём явную
// ошибку с временем разблокировки.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });

const TargetSchema = z
  .object({
    contactId: z.string().min(1).max(64).optional(),
    tgUserId: z.string().min(1).max(32).optional(),
  })
  .refine((v) => !!v.contactId || !!v.tgUserId, {
    message: "Either contactId or tgUserId is required",
  });

const PreviewBody = z
  .object({
    contactId: z.string().min(1).max(64).optional(),
    tgUserId: z.string().min(1).max(32).optional(),
  })
  .refine((v) => !!v.contactId || !!v.tgUserId, {
    message: "Either contactId or tgUserId is required",
  })
  .openapi("QuickSendPreviewQuery");

const SendBody = z
  .object({
    accountId: z.string().min(1).max(64),
    contactId: z.string().min(1).max(64).optional(),
    tgUserId: z.string().min(1).max(32).optional(),
    text: z.string().min(1).max(4000),
  })
  .refine((v) => !!v.contactId || !!v.tgUserId, {
    message: "Either contactId or tgUserId is required",
  })
  .openapi("QuickSendBody");

const ProjectRefSchema = z
  .object({ id: z.string(), name: z.string() })
  .openapi("ProjectRef");

const PreviewResponse = z
  .object({ activeProjects: z.array(ProjectRefSchema) })
  .openapi("QuickSendPreview");

const SendResponse = z
  .object({
    status: z.enum(["sent"]),
    cancelledProjects: z.array(ProjectRefSchema),
  })
  .openapi("QuickSendResult");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Helper: resolve target tg_user_id из contactId | tgUserId.
// Возвращает tg_user_id (string), либо HTTPException.
async function resolveTargetTgUserId(
  wsId: string,
  body: { contactId?: string; tgUserId?: string },
): Promise<string> {
  if (body.tgUserId) return body.tgUserId;
  const [row] = await db
    .select({ tgUserId: contactTgUserIdSql })
    .from(contacts)
    .where(and(eq(contacts.id, body.contactId!), eq(contacts.workspaceId, wsId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "contact not found" });
  if (!row.tgUserId) {
    throw new HTTPException(400, {
      message: "Contact has no Telegram id — нельзя отправить, пока не было ни одного сообщения",
    });
  }
  return row.tgUserId;
}

// Helper: список активных проектов где у peer'а есть pending scheduled.
// Возвращает уникальные {id, name} в порядке имени.
async function getActiveProjectsForPeer(
  wsId: string,
  tgUserId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .selectDistinct({ id: projects.id, name: projects.name })
    .from(scheduledMessages)
    .innerJoin(projectItems, eq(projectItems.id, scheduledMessages.itemId))
    .innerJoin(projects, eq(projects.id, scheduledMessages.projectId))
    .where(
      and(
        eq(scheduledMessages.workspaceId, wsId),
        eq(scheduledMessages.status, "pending"),
        eq(projectItems.tgUserId, tgUserId),
      ),
    );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/quick-send/preview",
    tags: ["quick-send"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: PreviewBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: PreviewResponse } },
        description: "Active projects for peer",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");
    const tgUserId = await resolveTargetTgUserId(wsId, body);
    const activeProjects = await getActiveProjectsForPeer(wsId, tgUserId);
    return c.json({ activeProjects });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/quick-send",
    tags: ["quick-send"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: SendBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: SendResponse } },
        description: "Sent",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const body = c.req.valid("json");

    const [acc] = await db
      .select()
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, body.accountId),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (!acc) throw new HTTPException(404, { message: "account not found" });
    if (acc.status !== "active") {
      throw new HTTPException(400, {
        message: `Account is ${acc.status} — нельзя отправить`,
      });
    }

    // Cooldown — пока in-memory (мигрируем в БД в D1). На рестарт API
    // обнулится — известный gap.
    const cooldown = accountCooldownUntil.get(acc.id);
    if (cooldown && cooldown > Date.now()) {
      const wait = Math.ceil((cooldown - Date.now()) / 1000);
      throw new HTTPException(429, {
        message: `Аккаунт в cooldown (FloodWait) ещё ${wait} сек`,
      });
    }

    const tgUserId = await resolveTargetTgUserId(wsId, body);

    // Отменяем pending'и для этого peer'а во всех проектах. Под капотом
    // worker увидит status='cancelled' и больше их не возьмёт. Если
    // pending уже захвачен другим tick'ом — race возможен, но он на TG-уровне
    // безобиден (просто отправится одно лишнее сообщение).
    const cancelled = await db
      .update(scheduledMessages)
      .set({ status: "cancelled", error: "manual takeover" })
      .where(
        and(
          eq(scheduledMessages.workspaceId, wsId),
          eq(scheduledMessages.status, "pending"),
          inArray(
            scheduledMessages.itemId,
            db
              .select({ id: projectItems.id })
              .from(projectItems)
              .where(
                and(
                  eq(projectItems.workspaceId, wsId),
                  eq(projectItems.tgUserId, tgUserId),
                ),
              ),
          ),
        ),
      )
      .returning({ projectId: scheduledMessages.projectId });

    const cancelledProjectIds = [...new Set(cancelled.map((r) => r.projectId))];
    const cancelledProjects =
      cancelledProjectIds.length > 0
        ? await db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, cancelledProjectIds))
        : [];
    for (const id of cancelledProjectIds) emitProjectChanged(id);

    // Отправка через TDLib. Используем тот же worker-client, что и
    // outreach-worker (он держит persistent TDLib и push-update'ы).
    const client = await getOutreachWorkerClient({
      id: acc.id,
      workspaceId: wsId,
    });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    try {
      await client.invoke({
        _: "sendMessage",
        chat_id: Number(tgUserId),
        input_message_content: {
          _: "inputMessageText",
          text: { _: "formattedText", text: body.text, entities: [] },
          link_preview_options: {
            _: "linkPreviewOptions",
            is_disabled: true,
          },
          clear_draft: false,
        },
      } as never);
    } catch (e) {
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        const waitMs = (flood + 5) * 1000;
        accountCooldownUntil.set(acc.id, Date.now() + waitMs);
        throw new HTTPException(429, {
          message: `Telegram FloodWait — аккаунт замолчал на ${flood} сек`,
        });
      }
      throw new HTTPException(400, { message: msg });
    }

    return c.json({ status: "sent" as const, cancelledProjects });
  },
);

function parseFloodWaitSeconds(msg: string): number | null {
  const m1 = msg.match(/retry after (\d+)/i);
  if (m1) return Number(m1[1]);
  const m2 = msg.match(/FLOOD_WAIT_(\d+)/);
  if (m2) return Number(m2[1]);
  const m3 = msg.match(/SLOWMODE_WAIT_(\d+)/);
  if (m3) return Number(m3[1]);
  return null;
}

export default app;

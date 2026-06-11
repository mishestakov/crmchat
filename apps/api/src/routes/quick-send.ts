import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
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
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
  setAccountCooldown,
} from "../lib/outreach-account-client.ts";
import { emitProjectChanged } from "../lib/events.ts";
import { FINAL_OFFER_MSG_IDX } from "../lib/project-scheduling.ts";
import { readOnTelegram } from "./contacts.ts";
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
    // Ответ на конкретное сообщение этого же чата (контекст-меню в переписке).
    replyToMessageId: z.string().min(1).max(64).optional(),
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

// Resolve tg_user_id для peer'а. Возвращает null если у контакта только
// @username без id — caller сам решает что делать. Lazy-резолва тут нет:
// chat-history endpoint всё равно дёрнет ensureContactTgUserId на открытии
// drawer'а и сохранит id в properties, после чего send уже найдёт его.
async function resolveTargetTgUserId(
  wsId: string,
  body: { contactId?: string; tgUserId?: string },
): Promise<string | null> {
  if (body.tgUserId) return body.tgUserId;
  const [row] = await db
    .select({ tgUserId: contactTgUserIdSql })
    .from(contacts)
    .where(and(eq(contacts.id, body.contactId!), eq(contacts.workspaceId, wsId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "contact not found" });
  return row.tgUserId;
}

// Helper: список проектов где у peer'а есть pending scheduled (для warning'а
// в drawer'е). Active + paused — в paused worker не отправит сейчас, но на
// resume цепочка возобновится, юзер должен видеть что она там есть.
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
        inArray(projects.status, ["active", "paused"]),
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
    // Без lazyClient: если у peer'а нет id — pending'ов и так нет (они на
    // tg_user_id ссылаются), возвращаем пустой список. Лезть в TG за id
    // на каждое открытие drawer'а не хотим — это сделает send-ветка.
    const tgUserId = await resolveTargetTgUserId(wsId, body);
    if (!tgUserId) return c.json({ activeProjects: [] });
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

    if (acc.cooldownUntil && acc.cooldownUntil.getTime() > Date.now()) {
      const wait = Math.ceil(
        (acc.cooldownUntil.getTime() - Date.now()) / 1000,
      );
      throw new HTTPException(429, {
        message: `Аккаунт в cooldown (${acc.cooldownReason ?? "FloodWait"}) ещё ${wait} сек`,
      });
    }

    const tgUserId = await resolveTargetTgUserId(wsId, body);
    if (!tgUserId) {
      throw new HTTPException(400, {
        message:
          "У контакта ещё нет TG ID — откройте чат в drawer'е, чтобы резолвить @username",
      });
    }

    // Отменяем pending'и холодной цепочки для этого peer'а во всех проектах:
    // ручная отправка = «беру переписку на себя», авто-пинги больше не нужны.
    // НО финальный оффер (msg_idx=FINAL_OFFER_MSG_IDX) не трогаем — он осознанно
    // адресован уже ответившим, и ручное сообщение/ERID-отправка не должны его
    // гасить (та же логика, что в worker/listener).
    const cancelled = await db
      .update(scheduledMessages)
      .set({ status: "cancelled", error: "manual takeover" })
      .where(
        and(
          eq(scheduledMessages.workspaceId, wsId),
          eq(scheduledMessages.status, "pending"),
          lt(scheduledMessages.messageIdx, FINAL_OFFER_MSG_IDX),
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
        // td_api.tl: reply_to:InputMessageReplyTo, для same-chat ответа —
        // inputMessageReplyToMessage (quote не передаём — отвечаем целиком).
        ...(body.replyToMessageId
          ? {
              reply_to: {
                _: "inputMessageReplyToMessage",
                message_id: Number(body.replyToMessageId),
              },
            }
          : {}),
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

      // Privacy-policy: помечаем прочитанным только при отправке ответа, не
      // при просмотре. Fire-and-forget — TG потом пришлёт updateChatReadInbox
      // → listener сбросит contacts.unread_count → SSE → бэйдж погаснет в UI.
      void readOnTelegram(wsId, body.accountId, tgUserId).catch((e) => {
        console.error(`[quick-send] viewMessages failed:`, errMsg(e));
      });
    } catch (e) {
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        const waitMs = (flood + 5) * 1000;
        await setAccountCooldown(
          acc.id,
          Date.now() + waitMs,
          `FloodWait ${flood}s`,
        );
        throw new HTTPException(429, {
          message: `Telegram FloodWait — аккаунт замолчал на ${flood} сек`,
        });
      }
      throw new HTTPException(400, { message: msg });
    }

    return c.json({ status: "sent" as const, cancelledProjects });
  },
);

export default app;

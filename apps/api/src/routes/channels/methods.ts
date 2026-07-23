// Способ связи «чат» (группа обсуждения / личка канала): чтение истории и
// отправка через аккаунт-участника (method-history, method-send).
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { errMsg } from "../../lib/errors.ts";
import {
  type TdContent,
  extractFormattedText,
  inputMessageText,
} from "../../lib/td-message.ts";
import { channels, outreachAccounts } from "../../db/schema.ts";
import { assertChannelAccess } from "../../lib/channels-access.ts";
import {
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
  setAccountCooldown,
} from "../../lib/outreach-account-client.ts";
import {
  accountAccessClause,
  assertAccountAccess,
} from "../../lib/outreach-access.ts";
import type {
  WorkspaceRole,
  WorkspaceVars,
} from "../../middleware/assert-member.ts";
import { WsIdParam } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Выбор активного аккаунта workspace'а БЕЗ подъёма TdClient (только id) —
// клиент всё равно поднимается ниже в ручке, незачем бутить дважды.
async function pickActiveAccountId(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<string | null> {
  const [acc] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  return acc?.id ?? null;
}

// Аккаунт-«хозяин» лички канала. В личка-группе канала у КАЖДОГО аккаунта свой
// per-sender топик, поэтому чтение и отправка обязаны идти через один аккаунт —
// иначе тред раздваивается (ответ уходит от другого имени в отдельную
// переписку). Закрепляем первый написавший аккаунт в meta.dm_account_id и
// держимся за него, пока он существует. Тенанси по нему — как у группы: ручка
// зовёт assertAccountAccess (404 для чужого аккаунта не-админу).
async function resolveDmAccountId(
  channel: typeof channels.$inferSelect,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<string | null> {
  const meta = (channel.meta ?? {}) as Record<string, unknown>;
  const pinned =
    typeof meta.dm_account_id === "string" ? meta.dm_account_id : null;
  if (pinned) {
    const [exists] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, pinned),
          eq(outreachAccounts.workspaceId, wsId),
        ),
      )
      .limit(1);
    if (exists) return pinned;
  }
  const picked = await pickActiveAccountId(wsId, userId, role);
  if (!picked) return null;
  if (picked !== pinned) {
    await db
      .update(channels)
      .set({
        meta: sql`${channels.meta} || jsonb_build_object('dm_account_id', ${picked}::text)`,
      })
      .where(eq(channels.id, channel.id));
  }
  return picked;
}

// Чат «способа связи через чат» (этап 16.9): читаем/пишем историю группы
// обсуждения ИЛИ лички канала через аккаунт-участника. В отличие от /history
// (broadcast-канал) — сообщения от разных участников, поэтому возвращаем
// senderName на каждом.
//
// `target` задаёт намерение вызывающего и разрешается ОДНОЗНАЧНО — каждая точка
// входа ведёт ровно туда, что на ней написано (каталоговая «личка» != группа):
//   • "group" — chat_id + аккаунт-участник из meta.contact_method (их кладёт
//     set-admin при выборе группы; вывести из канала их нельзя).
//   • "dm" — личка-группа канала (meta.direct_messages_chat_id, кладёт sync);
//     sendMessage туда = как в обычную группу; аккаунт закреплён (resolveDmAccountId).
//   • undefined — дефолт по факту выбранного способа (группа если выбрана, иначе
//     личка) — для совместимости; новые вызовы передают target явно.
// dmStarCost != null → платная личка: чтение разрешаем, отправку блокирует
// вызывающий (платное = вручную, см. spec §16.9).
async function resolveMethodChat(
  channel: typeof channels.$inferSelect,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
  target?: "group" | "dm",
): Promise<{ chatId: number; accountId: string; dmStarCost: number | null }> {
  const meta = (channel.meta ?? {}) as Record<string, unknown>;
  const cm = meta.contact_method as
    | { kind?: string; chat_id?: string | number; account_id?: string }
    | undefined;
  const wantGroup =
    target === "group" || (target === undefined && cm?.kind === "group");
  if (wantGroup) {
    if (cm?.kind === "group" && cm.chat_id != null && cm.account_id) {
      return {
        chatId: Number(cm.chat_id),
        accountId: cm.account_id,
        dmStarCost: null,
      };
    }
    throw new HTTPException(400, {
      message: "у канала не выбрана группа как способ связи",
    });
  }
  const dmChatId = meta.direct_messages_chat_id;
  if (dmChatId != null && String(dmChatId) !== "0") {
    const accountId = await resolveDmAccountId(channel, wsId, userId, role);
    if (!accountId) {
      throw new HTTPException(503, {
        message: "нет активного Telegram-аккаунта для лички канала",
      });
    }
    const star =
      typeof meta.outgoing_paid_message_star_count === "number"
        ? meta.outgoing_paid_message_star_count
        : null;
    return { chatId: Number(dmChatId), accountId, dmStarCost: star };
  }
  throw new HTTPException(400, {
    message: "у канала не выбран способ связи через чат (группа/личка)",
  });
}

const GroupHistoryItem = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  text: z.string(),
  isOutgoing: z.boolean(),
  senderName: z.string(),
});
const GroupHistoryResponse = z.object({
  messages: z.array(GroupHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/method-history",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        fromMessageId: z.coerce.number().int().nonnegative().optional(),
        // Намерение: "group" — чат обсуждения, "dm" — личка канала. Каталог
        // лички шлёт "dm" явно (иначе при выбранной группе ушли бы в группу).
        target: z.enum(["group", "dm"]).optional(),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: GroupHistoryResponse },
        },
        description: "Group history with per-message sender",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { limit, fromMessageId, target } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const { chatId, accountId } = await resolveMethodChat(
      channel,
      wsId,
      userId,
      role,
      target,
    );
    // Tenancy: аккаунт-участник доступен пользователю (404 иначе — нельзя читать
    // чужой чат через чужой аккаунт). Закреплённый аккаунт лички тоже проходит
    // через эту проверку — чужой колеги-аккаунт даст честный 404, не форк треда.
    await assertAccountAccess(accountId, wsId, userId, role);
    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    type TdMsg = {
      id: number;
      date: number;
      is_outgoing: boolean;
      content: TdContent;
      sender_id: { _: string; user_id?: number; chat_id?: number };
      // Подпись анонимного админа группы (td_api.tl §message.author_signature).
      author_signature?: string;
    };

    let opened = false;
    let aggregated: TdMsg[] = [];
    try {
      await client.invoke({ _: "openChat", chat_id: chatId } as never);
      opened = true;
      let from = fromMessageId ?? 0;
      for (let i = 0; i < 5; i++) {
        const r = (await client.invoke({
          _: "getChatHistory",
          chat_id: chatId,
          from_message_id: from,
          offset: 0,
          limit: limit - aggregated.length,
          only_local: false,
        } as never)) as { messages: TdMsg[] };
        if (!r.messages?.length) break;
        aggregated = [...aggregated, ...r.messages];
        if (aggregated.length >= limit) break;
        from = Number(r.messages[r.messages.length - 1]!.id);
      }
    } catch (e) {
      throw new HTTPException(404, {
        message: `group history failed: ${errMsg(e)}`,
      });
    } finally {
      if (opened) {
        await client
          .invoke({ _: "closeChat", chat_id: chatId } as never)
          .catch(() => {});
      }
    }

    // Имена отправителей-юзеров: getUser — offline для юзер-аккаунтов
    // (td_api.tl §getUser), участники уже в TDLib-кэше после openChat. Кэш на
    // запрос: один getUser на уникального отправителя, не на сообщение.
    const nameCache = new Map<number, string>();
    const resolveUserName = async (uid: number): Promise<string> => {
      const cached = nameCache.get(uid);
      if (cached) return cached;
      let name = `Участник ${uid}`;
      try {
        const u = (await client.invoke({
          _: "getUser",
          user_id: uid,
        } as never)) as {
          first_name?: string;
          last_name?: string;
          usernames?: { active_usernames?: string[] };
        };
        const full = [u.first_name, u.last_name].filter(Boolean).join(" ");
        name =
          full ||
          (u.usernames?.active_usernames?.[0]
            ? `@${u.usernames.active_usernames[0]}`
            : name);
      } catch {
        // offline-miss → fallback на «Участник {id}»
      }
      nameCache.set(uid, name);
      return name;
    };

    const messages = [];
    for (const m of aggregated) {
      const { text } = extractFormattedText(m.content);
      // Отправитель: свой → «Вы»; юзер → имя (getUser); анонимный админ
      // (messageSenderChat) → author_signature или общая метка.
      const senderName = m.is_outgoing
        ? "Вы"
        : m.sender_id._ === "messageSenderUser" && m.sender_id.user_id != null
          ? await resolveUserName(m.sender_id.user_id)
          : m.author_signature || "Админ группы";
      messages.push({
        id: String(m.id),
        date: new Date(m.date * 1000).toISOString(),
        text: text || "[медиа]",
        isOutgoing: !!m.is_outgoing,
        senderName,
      });
    }
    return c.json({ messages });
  },
);

const GroupSendBody = z.object({
  text: z.string().min(1).max(4096),
  // Намерение: "group" — чат обсуждения, "dm" — личка канала (см. method-history).
  target: z.enum(["group", "dm"]).optional(),
});

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/method-send",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: GroupSendBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Sent to group" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { text, target } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const { chatId, accountId, dmStarCost } = await resolveMethodChat(
      channel,
      wsId,
      userId,
      role,
      target,
    );
    // Платная личка канала = ручной способ: не списываем звёзды с аккаунта из
    // CRM, менеджер пишет сам в Telegram (spec §16.9). Чтение (history) при этом
    // разрешено.
    if (dmStarCost != null && dmStarCost > 0) {
      throw new HTTPException(400, {
        message: `Личка канала платная (${dmStarCost}⭐) — отправьте вручную в Telegram`,
      });
    }
    // Tenancy: аккаунт-участник доступен пользователю.
    await assertAccountAccess(accountId, wsId, userId, role);
    const client = await getOutreachWorkerClient({ id: accountId, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }
    try {
      // sendMessage оптимистичен (возвращает Message сразу). Проверяем
      // sending_state на синхронный отказ — платная группа/write-forbidden
      // (td_api.tl: messageSendingStateFailed.required_paid_message_star_count).
      // Async-отказ (slow-mode и т.п.) ловит updateMessageSendFailed-листенер,
      // как и у quick-send — полного подтверждения ручных отправок нет.
      const sent = (await client.invoke({
        _: "sendMessage",
        chat_id: chatId,
        input_message_content: inputMessageText(text),
      } as never)) as {
        sending_state?: {
          _: string;
          error?: { message?: string };
          required_paid_message_star_count?: number;
        };
      };
      if (sent.sending_state?._ === "messageSendingStateFailed") {
        const st = sent.sending_state;
        const paid = st.required_paid_message_star_count;
        throw new HTTPException(400, {
          message: paid
            ? `Группа требует ${paid}⭐ за сообщение — отправьте вручную`
            : `Telegram отклонил отправку: ${st.error?.message ?? "send failed"}`,
        });
      }
    } catch (e) {
      if (e instanceof HTTPException) throw e;
      const msg = errMsg(e);
      const flood = parseFloodWaitSeconds(msg);
      if (flood !== null) {
        await setAccountCooldown(accountId, Date.now() + (flood + 5) * 1000, `FloodWait ${flood}s`);
        throw new HTTPException(429, {
          message: `Telegram FloodWait — аккаунт замолчал на ${flood} сек`,
        });
      }
      throw new HTTPException(400, { message: msg });
    }
    return c.body(null, 204);
  },
);

export default app;

// Общие для роутов каналов символы (нужны >1 файлу-потребителю): схемы
// параметров, сериализация joinAdmins, схема Channel, выбор MAX-клиента.
import { z } from "@hono/zod-openapi";
import { and, eq, inArray } from "drizzle-orm";
import { type Channel, ChannelSchema as BaseChannelSchema } from "@repo/core";
import { db } from "../../db/client.ts";
import { getMaxWorkerClient } from "../../lib/max-account-client.ts";
import { pickMaxAccount } from "../../lib/max-conversation.ts";
import type { MaxClient } from "../../lib/max/index.ts";
import {
  channelAdmins,
  channelThumbnails,
  channels,
  contacts,
  outreachAccounts,
  tgChats,
} from "../../db/schema.ts";
import { channelIsRknSql } from "../../lib/rkn-registry.ts";
import type { WorkspaceRole } from "../../middleware/assert-member.ts";

// Любой активный MAX-аккаунт workspace'а: публичные каналы MAX читаются без
// вступления, поэтому подписка не нужна (в отличие от приватных TG). Выбор
// аккаунта — общий pickMaxAccount; здесь поверх него поднимаем воркер-клиент.
async function pickMaxClient(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: MaxClient; accountId: string } | null> {
  const acc = await pickMaxAccount(wsId, userId, role);
  if (!acc) return null;
  try {
    const client = await getMaxWorkerClient(acc);
    return { client, accountId: acc.id };
  } catch {
    return null;
  }
}

const ChannelSchema = BaseChannelSchema.openapi("Channel");

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
});

// Достраивает Channel объекты массивом admins (с минимальными полями для
// рендера колонки «админ» и «закреплён за») + thumbnail из отдельной
// таблицы (LEFT JOIN, может быть null если соц-pull ещё не делали).
async function joinAdmins(
  rows: (typeof channels.$inferSelect)[],
): Promise<Channel[]> {
  if (rows.length === 0) return [];
  const wsId = rows[0]!.workspaceId;
  const channelIds = rows.map((r) => r.id);
  const [adminRows, thumbRows, rknRows] = await Promise.all([
    db
      .select({
        channelId: channelAdmins.channelId,
        contactId: contacts.id,
        properties: contacts.properties,
        primaryAccountId: contacts.primaryAccountId,
      })
      .from(channelAdmins)
      .innerJoin(contacts, eq(channelAdmins.contactId, contacts.id))
      .where(inArray(channelAdmins.channelId, channelIds)),
    db
      .select({
        channelId: channelThumbnails.channelId,
        b64: channelThumbnails.b64,
      })
      .from(channelThumbnails)
      .where(inArray(channelThumbnails.channelId, channelIds)),
    // РКН-матчинг батчем по индексу rkn_records.match_key (T4.5).
    db
      .select({ id: channels.id, isRkn: channelIsRknSql })
      .from(channels)
      .where(inArray(channels.id, channelIds)),
  ]);
  const thumbByChannel = new Map(thumbRows.map((t) => [t.channelId, t.b64]));
  const rknByChannel = new Map(rknRows.map((r) => [r.id, r.isRkn]));

  // Диалоги команды с админами (tg_chats, воркспейс-wide) → «кружочки» в таблице.
  // Ключ — tg_user_id админа. Один запрос на весь батч каналов.
  const adminTgUserIds = [
    ...new Set(
      adminRows
        .map((a) => {
          const p = a.properties as Record<string, unknown>;
          return typeof p.tg_user_id === "string" ? p.tg_user_id : null;
        })
        .filter((x): x is string => x !== null),
    ),
  ];
  type ChatAccount = {
    accountId: string;
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  };
  const chatAccountsByPeer = new Map<string, ChatAccount[]>();
  if (adminTgUserIds.length > 0) {
    const chatRows = await db
      .select({
        peerUserId: tgChats.peerUserId,
        accountId: tgChats.accountId,
        lastInboundAt: tgChats.lastInboundAt,
        lastOutboundAt: tgChats.lastOutboundAt,
      })
      .from(tgChats)
      .innerJoin(outreachAccounts, eq(outreachAccounts.id, tgChats.accountId))
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          inArray(tgChats.peerUserId, adminTgUserIds),
          // «Общались» = админ нам ОТВЕТИЛ хотя бы раз, а не «мы написали» и не
          // «openChat по пустому чату». Сигнал — has_inbound (peer когда-либо
          // слал входящее), тот же, что в resolveWarmTgUserIds (warm-set).
          eq(tgChats.hasInbound, true),
        ),
      );
    for (const r of chatRows) {
      const list = chatAccountsByPeer.get(r.peerUserId) ?? [];
      list.push({
        accountId: r.accountId,
        lastInboundAt: r.lastInboundAt?.toISOString() ?? null,
        lastOutboundAt: r.lastOutboundAt?.toISOString() ?? null,
      });
      chatAccountsByPeer.set(r.peerUserId, list);
    }
  }

  const byChannel = new Map<
    string,
    {
      contactId: string;
      fullName: string | null;
      telegramUsername: string | null;
      primaryAccountId: string | null;
      chatAccounts: ChatAccount[];
    }[]
  >();
  for (const a of adminRows) {
    const props = a.properties as Record<string, unknown>;
    const tgUserId =
      typeof props.tg_user_id === "string" ? props.tg_user_id : null;
    const list = byChannel.get(a.channelId) ?? [];
    list.push({
      contactId: a.contactId,
      fullName:
        typeof props.full_name === "string" ? props.full_name : null,
      telegramUsername:
        typeof props.telegram_username === "string"
          ? props.telegram_username
          : null,
      primaryAccountId: a.primaryAccountId,
      chatAccounts: tgUserId ? chatAccountsByPeer.get(tgUserId) ?? [] : [],
    });
    byChannel.set(a.channelId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    platform: r.platform,
    externalId: r.externalId,
    title: r.title,
    description: r.description,
    relationStatus: r.relationStatus,
    relationHistory: r.relationHistory,
    username: r.username,
    link: r.link,
    memberCount: r.memberCount,
    meta: r.meta,
    properties: r.properties,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    unavailableSince: r.unavailableSince?.toISOString() ?? null,
    unavailableLastCheckAt: r.unavailableLastCheckAt?.toISOString() ?? null,
    unavailableReason: r.unavailableReason ?? null,
    thumbnailB64: thumbByChannel.get(r.id) ?? null,
    isRkn: rknByChannel.get(r.id) ?? false,
    admins: byChannel.get(r.id) ?? [],
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

export { ChannelSchema, WsIdParam, WsParam, joinAdmins, pickMaxClient };

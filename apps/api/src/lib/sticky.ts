import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { outreachAccounts, tgChats } from "../db/schema.ts";

// Двухуровневый sticky-резолвер v2 (правило «kто последним получил ответ»):
//
//  Уровень 1 — точная дата incoming. Среди аккаунтов воркспейса с
//  `tg_chats.last_inbound_at IS NOT NULL` для этого peer'а — победитель
//  тот, у кого MAX(last_inbound_at). Самый достоверный сигнал.
//
//  Уровень 2 — fallback на bool. Если на уровне 1 никто не подходит, но
//  у кого-то `has_inbound=true` (peer когда-то отвечал, дату из chat
//  payload TDLib не дал) — победитель тот, у кого MAX(last_message_at)
//  среди has_inbound=true. Покрывает кейс «последнее сообщение наше,
//  но peer когда-то нам писал» (Самвэл).
//
//  Иначе null — никто не «свой», в задаче пойдёт через round-robin.
//
//  По мере того как юзер открывает drawer'ы (chat-history endpoint
//  бэкфиллит точные даты в last_inbound_at) аккаунты автоматически
//  «дорастают» с уровня 2 до уровня 1.

export async function resolveStickyByPeerIds(
  workspaceId: string,
  peerUserIds: string[],
): Promise<Map<string, string>> {
  const winners = new Map<string, string>();
  if (peerUserIds.length === 0) return winners;

  // Уровень 1: точная дата.
  const level1 = await db
    .select({
      peerUserId: tgChats.peerUserId,
      accountId: tgChats.accountId,
    })
    .from(tgChats)
    .innerJoin(outreachAccounts, eq(outreachAccounts.id, tgChats.accountId))
    .where(
      and(
        eq(outreachAccounts.workspaceId, workspaceId),
        isNotNull(tgChats.lastInboundAt),
        inArray(tgChats.peerUserId, peerUserIds),
      ),
    )
    .orderBy(tgChats.peerUserId, desc(tgChats.lastInboundAt));
  for (const r of level1) {
    if (!winners.has(r.peerUserId)) winners.set(r.peerUserId, r.accountId);
  }

  // Уровень 2: bool-сигнал, для тех peer'ов, кого не покрыл уровень 1.
  const remaining = peerUserIds.filter((p) => !winners.has(p));
  if (remaining.length === 0) return winners;

  const level2 = await db
    .select({
      peerUserId: tgChats.peerUserId,
      accountId: tgChats.accountId,
    })
    .from(tgChats)
    .innerJoin(outreachAccounts, eq(outreachAccounts.id, tgChats.accountId))
    .where(
      and(
        eq(outreachAccounts.workspaceId, workspaceId),
        eq(tgChats.hasInbound, true),
        inArray(tgChats.peerUserId, remaining),
      ),
    )
    .orderBy(tgChats.peerUserId, sql`${tgChats.lastMessageAt} desc nulls last`);
  for (const r of level2) {
    if (!winners.has(r.peerUserId)) winners.set(r.peerUserId, r.accountId);
  }

  return winners;
}

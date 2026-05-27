import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channels,
  contacts,
  outreachAccounts,
  projectItems,
  scheduledMessages,
  tgChats,
  type ProjectMessage,
  type projects,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "./contact-sql.ts";
import { substituteVariables } from "./substitute-variables.ts";

// Helpers для активации проекта (/activate) и доливки лидов в активный
// проект (/imports POST при status=active|paused). Общая логика:
// разрешить sticky → warm-set → построить scheduled_messages row'ы со
// смещениями от baseTime, с round-robin для лидов без sticky.

export function delayToMs(delay: { period: string; value: number }): number {
  const v = delay.value;
  switch (delay.period) {
    case "minutes":
      return v * 60_000;
    case "hours":
      return v * 3_600_000;
    case "days":
      return v * 86_400_000;
    default:
      return 0;
  }
}

// Sentinel «ещё не запланировано»: msg_idx>0 при активации ложатся в БД с
// этим sendAt, чтобы worker их не брал. Реальный send_at пересчитывается
// после факт-отправки предыдущего шага из now+delay (см. outreach-worker).
// Год > 2900 дальше любых разумных follow-up'ов, UI учит этот порог и
// показывает «после предыдущего» вместо «через 974 года».
export const FOLLOWUP_PENDING_SENTINEL = new Date("2999-01-01T00:00:00Z");

// Sticky-резолвер: для набора tg_user_id возвращает Map → primary_account_id
// из contacts. Используется в /activate (резолв sticky перед round-robin) и
// в /leads (sticky-предсказание для draft-sequence — UI должен совпадать с
// фактическим распределением на activate).
export async function resolveStickyByTgUserIds(
  wsId: string,
  tgUserIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tgUserIds.length === 0) return map;
  const rows = await db
    .select({
      tgUserId: contactTgUserIdSql,
      accountId: contacts.primaryAccountId,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, wsId),
        isNotNull(contacts.primaryAccountId),
        inArray(contactTgUserIdSql, tgUserIds),
      ),
    );
  for (const r of rows) {
    if (r.tgUserId && r.accountId) map.set(r.tgUserId, r.accountId);
  }
  return map;
}

// Warm-set: peer когда-либо отвечал нам через любой аккаунт воркспейса
// (tg_chats.has_inbound=true). Используется чтобы для idx=0 применить
// warmText вместо холодного text.
export async function resolveWarmTgUserIds(
  wsId: string,
  tgUserIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (tgUserIds.length === 0) return out;
  const rows = await db
    .selectDistinct({ peerUserId: tgChats.peerUserId })
    .from(tgChats)
    .innerJoin(outreachAccounts, eq(tgChats.accountId, outreachAccounts.id))
    .where(
      and(
        eq(outreachAccounts.workspaceId, wsId),
        eq(tgChats.hasInbound, true),
        inArray(tgChats.peerUserId, tgUserIds),
      ),
    );
  for (const r of rows) out.add(r.peerUserId);
  return out;
}

export type SchedulingLead = {
  id: string;
  username: string | null;
  tgUserId: string | null;
  properties: Record<string, unknown>;
};

export type ScheduledRow = {
  workspaceId: string;
  projectId: string;
  itemId: string;
  accountId: string;
  messageIdx: number;
  text: string;
  sendAt: Date;
};

// Построить scheduled_messages row'ы для набора лидов. Sticky + warm
// резолвятся снаружи (вызывающий контролирует когда грузить), чтобы можно
// было переиспользовать для активации (загружает все лиды проекта одним
// батчем) и доливки (новые лиды одного импорта).
export function buildScheduledRows(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  accountIds: string[];
  leads: SchedulingLead[];
  baseTime: Date;
  priorByTgUserId: Map<string, string>;
  warmTgUserIds: Set<string>;
}): ScheduledRow[] {
  let rrIdx = 0;
  return opts.leads.flatMap((lead) => {
    const prior = lead.tgUserId
      ? opts.priorByTgUserId.get(lead.tgUserId)
      : undefined;
    const accountId = prior ?? opts.accountIds[rrIdx % opts.accountIds.length]!;
    if (!prior) rrIdx++;
    const isWarm = lead.tgUserId ? opts.warmTgUserIds.has(lead.tgUserId) : false;
    return opts.project.messages.map((msg, msgIdx) => {
      const warmText = msg.warmText?.trim();
      const template =
        msgIdx === 0 && isWarm && warmText ? warmText : msg.text;
      return {
        workspaceId: opts.wsId,
        projectId: opts.project.id,
        itemId: lead.id,
        accountId,
        messageIdx: msgIdx,
        text: substituteVariables(template, {
          username: lead.username,
          properties: lead.properties as Record<string, string>,
        }),
        // msg_idx=0 уходит «сразу как worker дойдёт»; догоны висят с
        // sentinel'ом, реальный sendAt получают после факт-отправки
        // предыдущего шага (см. scheduleNextFollowup в outreach-worker).
        sendAt: msgIdx === 0 ? opts.baseTime : FOLLOWUP_PENDING_SENTINEL,
      };
    });
  });
}

// Подготовка лидов агентского аутрича (этап 16.8). Один опенер на админа:
// дедуп по lower(username); подстановка {{каналы}} = все каналы этого админа
// в проекте (по неотобранным в шортлист размещениям); пропуск размещений без
// @username (личка/телефон — авто-опенер не адресуем, менеджер пишет вручную).
// skipContacted=true (доливка в активную кампанию) дополнительно опускает
// админов, с кем тред в проекте уже начат — повторный опенер не шлём.
export async function prepareAgencyLeads(opts: {
  projectId: string;
  leads: SchedulingLead[];
  skipContacted: boolean;
}): Promise<SchedulingLead[]> {
  const titleRows = await db
    .select({ username: projectItems.username, title: channels.title })
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .where(
      and(
        eq(projectItems.projectId, opts.projectId),
        eq(projectItems.kind, "placement"),
        isNull(projectItems.shortlistedAt),
      ),
    );
  const canals = new Map<string, string[]>();
  for (const r of titleRows) {
    if (!r.username) continue;
    const key = r.username.toLowerCase();
    const list = canals.get(key) ?? [];
    list.push(r.title ?? "канал");
    canals.set(key, list);
  }

  let contacted = new Set<string>();
  if (opts.skipContacted) {
    const rows = await db
      .selectDistinct({ u: sql<string>`lower(${projectItems.username})` })
      .from(scheduledMessages)
      .innerJoin(projectItems, eq(projectItems.id, scheduledMessages.itemId))
      .where(
        and(
          eq(scheduledMessages.projectId, opts.projectId),
          isNotNull(projectItems.username),
        ),
      );
    contacted = new Set(rows.map((r) => r.u));
  }

  const seen = new Set<string>();
  const out: SchedulingLead[] = [];
  for (const l of opts.leads) {
    if (!l.username) continue;
    const key = l.username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (opts.skipContacted && contacted.has(key)) continue;
    const list = canals.get(key);
    out.push({
      ...l,
      properties: list
        ? { ...l.properties, каналы: list.join(", ") }
        : l.properties,
    });
  }
  return out;
}

// Список аккаунтов, которые видит проект на момент активации/доливки:
// (active) ∩ (project.accountsMode/accountsSelected).
export async function resolveProjectAccountIds(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<string[]> {
  const accountRows = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.workspaceId, wsId),
        eq(outreachAccounts.status, "active"),
      ),
    );
  if (project.accountsMode === "all") return accountRows.map((a) => a.id);
  return accountRows
    .map((a) => a.id)
    .filter((id) => project.accountsSelected.includes(id));
}

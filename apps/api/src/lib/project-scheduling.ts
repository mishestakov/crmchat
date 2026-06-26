import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channels,
  contacts,
  outreachAccounts,
  projectItems,
  scheduledMessages,
  projects,
  workspaces,
  tgChats,
  tgUsers,
  type ProjectMessage,
  type MessageVariant,
  type ProjectDunning,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "./contact-sql.ts";
import { maxPeerRef } from "./max-account-client.ts";
import { channelRknBlockedSql } from "./rkn-registry.ts";
import { channelAlreadyWorkingSql } from "./platform-active.ts";
import { resolveStickyByPeerIds } from "./sticky.ts";
import { substituteVariables } from "./substitute-variables.ts";
import { messagesToOpenerDunning } from "./opener-dunning.ts";
import { nextAllowedSendAt } from "./outreach-schedule.ts";

// Helpers для активации проекта (/activate) и доливки размещений в активный
// проект (placements/bulk при status=active|paused). Общая логика:
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

// msg_idx финального оффера («вы выбраны», bulk-send на фазе «Подтверждение»).
// Высокий индекс отделяет его от холодной цепочки (0,1,2…): «отмена при ответе»
// гасит только холодную цепочку, финальный оффер шлём ВСЕГДА — он и адресован
// уже ответившим (одобренным клиентом) блогерам.
export const FINAL_OFFER_MSG_IDX = 1000;

// Sticky-резолвер: для набора tg_user_id возвращает Map → аккаунт, за которым
// «закреплён» этот peer. Используется в /activate (перед round-robin) и в
// /leads (предсказание для draft-sequence — UI должен совпасть с activate).
//
// Два уровня (этап 16.9 ревизия — без зависимости от дампа контактов):
//   1. Явный override — contacts.primary_account_id (ручное «закрепить» в чате
//      / привязанные админы).
//   2. Иначе — по РЕПЛИКЕ (воркспейс-wide): аккаунт с самым свежим диалогом с
//      этим peer'ом (tg_chats). Так «знакомый блогер липнет к своему аккаунту»
//      без материализации всех диалогов в контакты.
export async function resolveStickyByTgUserIds(
  wsId: string,
  tgUserIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tgUserIds.length === 0) return map;

  const explicit = await db
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
  for (const r of explicit) {
    if (r.tgUserId && r.accountId) map.set(r.tgUserId, r.accountId);
  }

  const missing = tgUserIds.filter((u) => !map.has(u));
  if (missing.length > 0) {
    // Реплика — канонический «кто последним получил ОТВЕТ» (sticky.ts): L1
    // max(last_inbound_at), L2 has_inbound. Тот же резолвер, что у contacts-
    // бэкфилла → предсказание (/leads) и факт (/activate) не расходятся.
    // Важно: аккаунт, который лишь холодно написал (без ответа peer'а), sticky
    // НЕ становится — иначе чужое исходящее перехватывало бы знакомого блогера.
    const replica = await resolveStickyByPeerIds(wsId, missing);
    for (const [peer, acc] of replica) {
      if (!map.has(peer)) map.set(peer, acc);
    }
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
  // Контакт лида. Для MAX-пути из него берётся пир получателя (max_user_id /
  // max_link). Опционально — инлайн-конструкции (bulk-доливка свежих TG-плейсментов
  // без контакта) его не передают.
  contactId?: string | null;
  // MAX-пир получателя — резолвится attachMaxPeer для лидов без @username по их
  // контакту. Присутствие = «это MAX-лид»: ведём MAX-аккаунтом, котики выключены.
  maxPeer?: string | null;
};

// Размещение → лид для планировщика. Общий для всех точек планирования
// (активация, доливка, возврат скипа, перенаправление): один shape, чтобы при
// смене формы лида не править в N местах.
function toSchedulingLead(item: {
  id: string;
  username: string | null;
  tgUserId: string | null;
  properties: unknown;
  contactId?: string | null;
}): SchedulingLead {
  return {
    id: item.id,
    username: item.username,
    tgUserId: item.tgUserId,
    contactId: item.contactId ?? null,
    properties: (item.properties ?? {}) as Record<string, unknown>,
  };
}

// Ключ «админа» для дедупа и синтеза канало-vars: TG → lower(@username),
// MAX-лид без @ → "c:"+contactId. null = неадресуемый (личка/телефон без
// контакта) — prepareLeads такой пропускает.
function adminKey(
  username: string | null,
  contactId: string | null | undefined,
): string | null {
  if (username) return username.toLowerCase();
  if (contactId) return "c:" + contactId;
  return null;
}

export type ScheduledRow = {
  workspaceId: string;
  projectId: string;
  itemId: string;
  accountId: string;
  messageIdx: number;
  // Заход пиналки: 0 — холодный авто-догон после опенера; этап C пишет 1,2…
  dunningRound: number;
  text: string;
  // Снимок стикер-пинга (котик) — если выбран стикер вместо текста; иначе null.
  stickerSetName: string | null;
  stickerUniqueId: string | null;
  sendAt: Date;
};

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// Выбор n пингов с чередованием текст/котик (договорённость с Юлей): нечётные
// пинги — текст, чётные — котик (первый всегда текстовый, котики разбавляют).
// Внутри каждого под-пула — без повтора (перетасовка). Graceful: если котиков
// или текстов не хватает на свою позицию, добираем из другого под-пула — серия
// не падает (напр. legacy-проект без котиков идёт целиком текстом). Если пул
// меньше n — вернём меньше пингов (серия короче); валидацию пула добавим в B2.
function pickPings(pings: MessageVariant[], n: number): MessageVariant[] {
  const texts = shuffle(pings.filter((p) => p.kind === "text"));
  const stickers = shuffle(pings.filter((p) => p.kind === "sticker"));
  const result: MessageVariant[] = [];
  let ti = 0;
  let si = 0;
  for (let pos = 1; pos <= n; pos++) {
    const wantSticker = pos % 2 === 0; // чётные позиции — котики
    let v = wantSticker ? stickers[si] : texts[ti];
    if (v) {
      if (wantSticker) si++;
      else ti++;
    } else {
      // graceful-добор из другого под-пула
      v = wantSticker ? texts[ti] : stickers[si];
      if (!v) break; // оба пула исчерпаны
      if (wantSticker) ti++;
      else si++;
    }
    result.push(v);
  }
  return result;
}

// Построить scheduled_messages row'ы для набора лидов. Sticky + warm
// резолвятся снаружи. Внутренний шаг scheduleLeads (не экспортируется).
//
// Раскладка холодного захода (dunning_round=0): опенер (idx 0, уходит сразу) +
// по одному пингу пиналки на каждый интервал каданса (idx 1..N, выбор из пула
// без повтора). Реальный sendAt пингов довзводится после факт-отправки
// предыдущего шага (scheduleNextFollowup в outreach-worker).
function buildScheduledRows(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  // Пиналка — одна на воркспейс (workspaces.dunning), резолвится снаружи.
  dunning: ProjectDunning;
  accountIds: string[];
  // MAX-пул проекта (отдельно от TG): MAX-лид ведётся только MAX-аккаунтом.
  maxAccountIds: string[];
  leads: SchedulingLead[];
  baseTime: Date;
  priorByTgUserId: Map<string, string>;
  warmTgUserIds: Set<string>;
  // accountId → имя отправителя (outreach_name ?? first_name) для {{отправитель}}.
  senderNameByAccountId: Map<string, string>;
}): ScheduledRow[] {
  // Опенер — проектный (fallback из messages для незабэкфилленных проектов).
  // Пиналка — workspace-уровень (opts.dunning).
  const opener =
    opts.project.opener ?? messagesToOpenerDunning(opts.project.messages).opener;
  const dunning = opts.dunning;
  // Котики — только TG: в MAX пинги текстовые (scheduler не кладёт стикер-снимок).
  const textOnlyPings = dunning.pings.filter((p) => p.kind === "text");

  let rrIdx = 0; // round-robin TG-пула
  let rrMaxIdx = 0; // round-robin MAX-пула
  return opts.leads.flatMap((lead) => {
    // Платформа лида = из контакта (maxPeer присутствует → MAX). MAX-лид тянет
    // аккаунт из MAX-пула, TG-лид — из TG-пула. Пул нужной платформы пуст
    // (напр. MAX-лид, а MAX-аккаунта в воркспейсе нет) → лид пропускаем: нечем
    // слать. «Доливка» подхватит его, когда аккаунт появится.
    const isMax = !!lead.maxPeer;
    const pool = isMax ? opts.maxAccountIds : opts.accountIds;
    if (pool.length === 0) return [];

    let accountId: string;
    if (isMax) {
      // MAX-стики для холодного опенера не делаем (MVP) — round-robin. Ручной
      // догон (armLeadDunning) берёт sticky-аккаунт из истории отправок.
      accountId = pool[rrMaxIdx % pool.length]!;
      rrMaxIdx++;
    } else {
      const priorRaw = lead.tgUserId
        ? opts.priorByTgUserId.get(lead.tgUserId)
        : undefined;
      // Sticky-аккаунт валиден только если он в наборе проекта (active ∩
      // accountsSelected). Иначе (peer общался с paused/не-выбранным аккаунтом)
      // — round-robin, а не отправка с аккаунта, которого в кампании нет.
      const prior = priorRaw && pool.includes(priorRaw) ? priorRaw : undefined;
      accountId = prior ?? pool[rrIdx % pool.length]!;
      if (!prior) rrIdx++;
    }
    const isWarm =
      !isMax && !!lead.tgUserId && opts.warmTgUserIds.has(lead.tgUserId);
    const subst = (t: string) =>
      substituteVariables(t, {
        username: lead.username,
        properties: lead.properties as Record<string, string>,
        senderName: opts.senderNameByAccountId.get(accountId) ?? null,
      });
    const base = {
      workspaceId: opts.wsId,
      projectId: opts.project.id,
      itemId: lead.id,
      accountId,
      dunningRound: 0,
    };

    const rows: ScheduledRow[] = [];
    // Опенер — idx 0, уходит сразу. warmText только для «тёплых».
    const openerWarm = opener.warmText?.trim();
    const openerText = isWarm && openerWarm ? openerWarm : opener.text;
    rows.push({
      ...base,
      messageIdx: 0,
      text: subst(openerText),
      stickerSetName: null,
      stickerUniqueId: null,
      sendAt: opts.baseTime,
    });
    // Пинги пиналки — по одному на интервал, выбор из пула без повтора.
    // MAX → только текстовые пинги (котиков нет).
    const chosen = pickPings(
      isMax ? textOnlyPings : dunning.pings,
      dunning.intervals.length,
    );
    chosen.forEach((v, i) => {
      rows.push({
        ...base,
        messageIdx: i + 1,
        text: v.kind === "text" ? subst(v.text) : "",
        stickerSetName: v.kind === "sticker" ? v.setName : null,
        stickerUniqueId: v.kind === "sticker" ? v.uniqueId : null,
        sendAt: FOLLOWUP_PENDING_SENTINEL,
      });
    });
    return rows;
  });
}

// Естественный идентификатор канала + ссылка для подстановки. TG → @username
// (кликабельное упоминание в личке) + t.me-ссылка; провайдер → ссылка. Fallback
// ident на title (приватный TG-канал / болванка). Общий для prepareLeads (батч
// по админам) и sample-lead (превью одного канала) — чтобы синтез
// {{канал}}/{{ссылка}} не разъезжался между ними.
export function channelIdentifier(ch: {
  platform: string | null;
  username: string | null;
  title: string | null;
  link: string | null;
}): { ident: string; link: string | null } {
  const tg = ch.platform === "telegram";
  const ident =
    (tg ? (ch.username ? `@${ch.username}` : null) : ch.link) ??
    ch.title ??
    "канал";
  const link =
    ch.link ?? (tg && ch.username ? `https://t.me/${ch.username}` : null);
  return { ident, link };
}

// Подготовка лидов аутрича — общая для BD и agency (несущий слой канало-
// центричной схемы). Один опенер на админа: дедуп по lower(username).
// Синтезирует свойства из базы каналов на момент активации (данные «текут» из
// площадки, а не из замороженного снимка):
//   {{каналы}} = идентификаторы ВСЕХ каналов админа в проекте (TG → @username,
//               провайдер → ссылка);
//   {{канал}}  = название первого канала админа (частый случай — 1 канал);
//   {{ссылка}} = ссылка первого канала админа.
// Пропуск размещений без @username админа (личка/телефон — авто-опенер не
// адресуем, менеджер пишет вручную). Пропуск ботов (ручной способ связи).
// skipContacted=true (доливка в активную кампанию) дополнительно опускает
// админов, с кем тред в проекте уже начат — повторный опенер не шлём.
async function prepareLeads(opts: {
  projectId: string;
  leads: SchedulingLead[];
  skipContacted: boolean;
}): Promise<SchedulingLead[]> {
  const channelRows = await db
    .select({
      adminUsername: projectItems.username,
      adminContactId: projectItems.contactId,
      platform: channels.platform,
      channelUsername: channels.username,
      link: channels.link,
      title: channels.title,
      rknBlocked: channelRknBlockedSql,
      alreadyWorking: channelAlreadyWorkingSql,
    })
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .where(
      and(
        eq(projectItems.projectId, opts.projectId),
        isNull(projectItems.shortlistedAt),
        // Отказавшихся не включаем в {{каналы}} (этап 16.10).
        sql`${projectItems.available} is distinct from false`,
      ),
    )
    // Детерминированный порядок: {{канал}}/{{ссылка}} = первый по дате
    // добавления канал админа (иначе «первый» зависел бы от плана Postgres
    // и расходился между запусками и с sample-lead-превью).
    .orderBy(asc(projectItems.createdAt));
  const canals = new Map<
    string,
    { idents: string[]; title: string | null; link: string | null }
  >();
  // РКН-гейт: админ годен, если ХОТЬ ОДИН его канал не отбракован по РКН
  // (lenient-OR — у одного админа обычно один канал; редкий микс трактуем в
  // пользу отправки: опенер один на админа и адресован легальному каналу).
  // «Отбракован» = обязан регистрироваться (>10к) и не в реестре — то же
  // условие, что красная пилюля «Нет РКН» (channelRknBlockedSql). Малые
  // (<10к) и неизвестные по размеру не блокируются.
  // «Уже работает на платформе»: канал уже крутится у нас в CPC/CPA
  // (platform_active_channels, суточный синк) — партнёра не пере-питчим.
  // Тоже lenient-OR и тоже исключение из sendable.
  const sendableKeys = new Set<string>();
  for (const r of channelRows) {
    // MAX-админ без @username ключуется по contactId (adminKey) — иначе выпал бы
    // из синтеза {{каналы}}/{{ссылка}}, как раньше любой no-@username.
    const key = adminKey(r.adminUsername, r.adminContactId);
    if (!key) continue;
    if (!r.rknBlocked && !r.alreadyWorking) sendableKeys.add(key);
    const entry = canals.get(key) ?? { idents: [], title: null, link: null };
    const { ident, link } = channelIdentifier({
      platform: r.platform,
      username: r.channelUsername,
      title: r.title,
      link: r.link,
    });
    entry.idents.push(ident);
    // {{канал}}/{{ссылка}} — первый канал админа (частый случай: 1 канал = 1
    // админ). При нескольких каналах полный список даёт {{каналы}}.
    if (entry.title === null) entry.title = r.title ?? ident;
    if (entry.link === null) entry.link = link;
    canals.set(key, entry);
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

  // Боты — ручной способ связи (этап 16.9): авто-опенер им не шлём (старт +
  // кнопки делает менеджер). Сигнал авторитетный — tg_users.is_bot (userTypeBot,
  // td_api.tl), НЕ суффикс @username (резал живых @talbot/@robot). Матчим И по
  // username (без ведущего @ — tg_users.username хранится голым), И по
  // tg_user_id (бот без публичного @username иначе проскочил бы prepare и упал
  // позже в worker'е как BOT_SKIPPED).
  const leadKeys = opts.leads
    .map((l) => l.username?.replace(/^@/, "").toLowerCase())
    .filter((u): u is string => !!u);
  const leadTgIds = opts.leads
    .map((l) => l.tgUserId)
    .filter((u): u is string => !!u);
  const botUsernames = new Set<string>();
  const botTgIds = new Set<string>();
  if (leadKeys.length > 0) {
    const rows = await db
      .select({ u: sql<string>`lower(${tgUsers.username})` })
      .from(tgUsers)
      .where(
        and(
          eq(tgUsers.isBot, true),
          inArray(sql`lower(${tgUsers.username})`, leadKeys),
        ),
      );
    for (const r of rows) botUsernames.add(r.u);
  }
  if (leadTgIds.length > 0) {
    const rows = await db
      .select({ id: tgUsers.userId })
      .from(tgUsers)
      .where(and(eq(tgUsers.isBot, true), inArray(tgUsers.userId, leadTgIds)));
    for (const r of rows) botTgIds.add(r.id);
  }

  const seen = new Set<string>();
  const out: SchedulingLead[] = [];
  for (const l of opts.leads) {
    // TG → lower(@username); MAX-лид (без @, но с резолвленным пиром) → "c:"+contactId.
    // Ни того, ни другого (личка/телефон без max-пира) → неадресуем, пропуск.
    const key = l.username
      ? l.username.toLowerCase()
      : adminKey(null, l.maxPeer ? l.contactId : null);
    if (!key) continue;
    // Бот-гейт — только для TG-лидов (у MAX нет ботов как способа связи).
    if (l.username) {
      if (botUsernames.has(l.username.replace(/^@/, "").toLowerCase())) continue;
      if (l.tgUserId && botTgIds.has(l.tgUserId)) continue;
    }
    // РКН-отбраковка: каналу, обязанному регистрироваться и не в реестре,
    // опенер не шлём (гейт квалификации).
    if (!sendableKeys.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    if (opts.skipContacted && contacted.has(key)) continue;
    const entry = canals.get(key);
    out.push({
      ...l,
      properties: entry
        ? {
            ...l.properties,
            каналы: entry.idents.join(", "),
            // entry.title всегда задан (channelIdentifier даёт fallback "канал");
            // ссылка может быть null (приватный канал без link) — тогда не кладём.
            канал: entry.title!,
            ...(entry.link ? { ссылка: entry.link } : {}),
          }
        : l.properties,
    });
  }
  return out;
}

// Аккаунты платформы, которые видит проект на момент активации/доливки:
// (active ∩ platform) ∩ (project.accountsMode/accountsSelected).
async function resolveProjectAccountIdsForPlatform(
  wsId: string,
  project: typeof projects.$inferSelect,
  platform: "telegram" | "max",
): Promise<string[]> {
  const accountRows = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.workspaceId, wsId),
        eq(outreachAccounts.platform, platform),
        eq(outreachAccounts.status, "active"),
      ),
    );
  if (project.accountsMode === "all") return accountRows.map((a) => a.id);
  return accountRows
    .map((a) => a.id)
    .filter((id) => project.accountsSelected.includes(id));
}

// TG-пул проекта. Telegram-only намеренно: финальный оффер/readiness не должны
// мешать MAX и TG в одном round-robin.
export function resolveProjectAccountIds(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<string[]> {
  return resolveProjectAccountIdsForPlatform(wsId, project, "telegram");
}

// MAX-пул проекта — отдельный пул под MAX-каданс.
export function resolveProjectMaxAccountIds(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<string[]> {
  return resolveProjectAccountIdsForPlatform(wsId, project, "max");
}

// Сколько из размещений — MAX-лиды (контакт с max_user_id/max_link, без
// @username). Для предупреждения при активации, когда активного MAX-аккаунта нет
// и такие лиды тихо выпали бы из каданса.
export async function countMaxLeadsAmong(itemIds: string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const rows = await db
    .select({ id: projectItems.id })
    .from(projectItems)
    .innerJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(
      and(
        inArray(projectItems.id, itemIds),
        isNull(projectItems.username),
        // Непустые значения (как maxPeerRef: пустая строка ≠ пир) — счётчик не
        // должен расходиться с тем, что реально планируется.
        sql`(${contacts.properties} ->> 'max_user_id' <> '' or ${contacts.properties} ->> 'max_link' <> '')`,
      ),
    );
  return rows.length;
}

// Дозаполняет maxPeer лидам без @username по их контакту (max_user_id
// предпочтительно, иначе max_link). Лиды с @username — телеграмные, не трогаем.
// Лид без username и без max-пира остаётся неадресуемым (prepareLeads отбросит).
async function attachMaxPeer(
  leads: SchedulingLead[],
): Promise<SchedulingLead[]> {
  const need = leads.filter((l) => !l.username && l.contactId);
  if (need.length === 0) return leads;
  const contactIds = [...new Set(need.map((l) => l.contactId!))];
  const rows = await db
    .select({ id: contacts.id, properties: contacts.properties })
    .from(contacts)
    .where(inArray(contacts.id, contactIds));
  const peerByContact = new Map<string, string>();
  for (const c of rows) {
    const ref = maxPeerRef(c.properties);
    if (ref) peerByContact.set(c.id, ref);
  }
  if (peerByContact.size === 0) return leads;
  return leads.map((l) =>
    !l.username && l.contactId && peerByContact.has(l.contactId)
      ? { ...l, maxPeer: peerByContact.get(l.contactId)! }
      : l,
  );
}

// Пиналка — одна на воркспейс (workspaces.dunning). Fallback из project.messages
// на переходный период (незабэкфилленный воркспейс).
async function resolveWorkspaceDunning(
  wsId: string,
  project: typeof projects.$inferSelect,
): Promise<ProjectDunning> {
  const [ws] = await db
    .select({ dunning: workspaces.dunning })
    .from(workspaces)
    .where(eq(workspaces.id, wsId))
    .limit(1);
  return ws?.dunning ?? messagesToOpenerDunning(project.messages).dunning;
}

// Конвейер «лиды проекта → scheduled-строки» — общий путь активации и доливки:
// prepareLeads (дедуп по админу + синтез канало-vars) → sticky + warm →
// buildScheduledRows. Вставку строк делает вызывающий (в своей транзакции).
export async function scheduleLeads(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  accountIds: string[];
  leads: SchedulingLead[];
  baseTime: Date;
  skipContacted: boolean;
}): Promise<ScheduledRow[]> {
  // MAX-пир резолвим ДО prepareLeads: иначе MAX-лид (без @username) отвалится в
  // username-гейте. accountIds (TG) приходит снаружи; MAX-пул резолвим тут сами —
  // не тащим через всех вызывающих (компромисс: MAX-каданс требует ≥1 TG-аккаунта
  // в воркспейсе, чтобы пройти верхний accountIds-гард; для TG-first это всегда так).
  const withMax = await attachMaxPeer(opts.leads);
  const prepared = await prepareLeads({
    projectId: opts.project.id,
    leads: withMax,
    skipContacted: opts.skipContacted,
  });
  if (prepared.length === 0) return [];
  const tgUserIds = prepared
    .map((l) => l.tgUserId)
    .filter((x): x is string => x !== null);
  // sticky и warm независимы (общий вход tgUserIds) — параллелим.
  const [priorByTgUserId, warmTgUserIds, dunning, maxAccountIds] =
    await Promise.all([
      resolveStickyByTgUserIds(opts.wsId, tgUserIds),
      resolveWarmTgUserIds(opts.wsId, tgUserIds),
      resolveWorkspaceDunning(opts.wsId, opts.project),
      resolveProjectMaxAccountIds(opts.wsId, opts.project),
    ]);
  // Имена отправителей по всем аккаунтам в игре (TG ∪ MAX) — для {{отправитель}}.
  // Дубли id безвредны: SQL IN и Map-ключ их схлопывают.
  const senderNameByAccountId = await resolveSenderNames([
    ...opts.accountIds,
    ...maxAccountIds,
  ]);
  return buildScheduledRows({
    wsId: opts.wsId,
    project: opts.project,
    dunning,
    accountIds: opts.accountIds,
    maxAccountIds,
    leads: prepared,
    baseTime: opts.baseTime,
    priorByTgUserId,
    warmTgUserIds,
    senderNameByAccountId,
  });
}

// accountId → имя отправителя для {{отправитель}}: outreach_name (override
// менеджера) ?? first_name (TG-профиль). Пустые/null имена в карту не кладём —
// тогда {{отправитель}} останется placeholder'ом (виден в preview/тексте).
// Экспортируется: тот же резолвер нужен всем account-aware путям подстановки
// (холодная серия, ручной взвод, финальный оффер), чтобы переменная не уехала
// литералом в части из них.
export async function resolveSenderNames(
  accountIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (accountIds.length === 0) return map;
  const rows = await db
    .select({
      id: outreachAccounts.id,
      name: sql<
        string | null
      >`coalesce(${outreachAccounts.outreachName}, ${outreachAccounts.firstName})`,
    })
    .from(outreachAccounts)
    .where(inArray(outreachAccounts.id, accountIds));
  for (const r of rows) {
    const n = r.name?.trim();
    if (n) map.set(r.id, n);
  }
  return map;
}


// Размещения лонглиста, до которых авто-рассылка ещё не добиралась: нет ни
// pending (в очереди), ни sent (цепочка начата), ни failed (постоянная ошибка
// — переотправка упадёт так же). Cancelled не блокирует: после скипа лида его
// pending удаляются, а «Вернуть в рассылку» приводит сюда же.
const unscheduledLeadSql = sql`not exists (
  select 1 from scheduled_messages sm
  where sm.item_id = ${projectItems.id}
    and sm.status in ('pending', 'sent', 'failed')
)`;

// Допланировать опенеры незапланированным лидам проекта (холодная доливка по
// явной кнопке, возврат скипнутого лида). Возвращает число админов, вставших
// в очередь. itemId сужает до одного размещения (unskip).
export async function scheduleUnscheduledLeads(opts: {
  project: typeof projects.$inferSelect;
  itemId?: string;
}): Promise<number> {
  const { project } = opts;
  const accountIds = await resolveProjectAccountIds(
    project.workspaceId,
    project,
  );
  if (accountIds.length === 0) return 0;
  const items = await db
    .select({
      id: projectItems.id,
      username: projectItems.username,
      tgUserId: projectItems.tgUserId,
      properties: projectItems.properties,
    })
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .where(
      and(
        eq(projectItems.projectId, project.id),
        ...(opts.itemId ? [eq(projectItems.id, opts.itemId)] : []),
        isNotNull(projectItems.username),
        isNull(projectItems.shortlistedAt),
        isNull(projectItems.skippedAt),
        sql`${projectItems.available} is distinct from false`,
        // Отбракованных по РКН не планируем и здесь (мирроринг гейта в
        // prepareLeads) — счётчик и действие должны совпадать. `is not true`,
        // а не `not (...)`: NULL (неизвестный размер) = годен (см.
        // countUnscheduledLeads).
        sql`${channelRknBlockedSql} is not true`,
        // «уже работает у нас» — тоже не планируем.
        sql`not ${channelAlreadyWorkingSql}`,
        unscheduledLeadSql,
      ),
    )
    .orderBy(asc(projectItems.createdAt));
  if (items.length === 0) return 0;
  const newRows = await scheduleLeads({
    wsId: project.workspaceId,
    project,
    accountIds,
    leads: items.map(toSchedulingLead),
    baseTime: new Date(),
    skipContacted: true,
  });
  if (newRows.length > 0) {
    await db.insert(scheduledMessages).values(newRows);
  }
  return new Set(newRows.map((r) => r.itemId)).size;
}

// Поздняя доливка (10.06.26, «доливка 100% нужна»): канал добавили в ИДУЩИЙ
// проект без контакта, контакт нашли позже (set-admin/admins → heal).
// scheduleDolivka на bulk-импорте такие размещения отбрасывает (нет
// получателя) — без этого вызова опенер им не запланирует никто и канал
// молча выпадает из рассылки. paused тоже планируем: worker на паузе не
// шлёт, после resume уйдёт. Холодного гейта больше нет (model A): резолв
// контакта в любом идущем проекте сразу планирует опенер, без явной кнопки.
export async function scheduleDolivkaForChannel(
  channelId: string,
): Promise<void> {
  const rows = await db
    .select({ item: projectItems, project: projects })
    .from(projectItems)
    .innerJoin(projects, eq(projects.id, projectItems.projectId))
    .where(
      and(
        eq(projectItems.channelId, channelId),
        inArray(projects.status, ["active", "paused"]),
        isNull(projectItems.skippedAt),
        sql`not exists (
          select 1 from scheduled_messages sm where sm.item_id = ${projectItems.id}
        )`,
      ),
    );
  if (rows.length === 0) return;
  const byProject = Map.groupBy(rows, (r) => r.project.id);
  for (const group of byProject.values()) {
    const project = group[0]!.project;
    const accountIds = await resolveProjectAccountIds(
      project.workspaceId,
      project,
    );
    if (accountIds.length === 0) continue;
    const newRows = await scheduleLeads({
      wsId: project.workspaceId,
      project,
      accountIds,
      leads: group.map((r) => toSchedulingLead(r.item)),
      baseTime: new Date(),
      skipContacted: true,
    });
    if (newRows.length > 0) {
      await db.insert(scheduledMessages).values(newRows);
    }
  }
}

// Перенаправление контакта (явная смена админа канала, set-admin override):
// контакт сменился на другого человека. Старый график был адресован прежнему
// контакту — ОБНУЛЯЕМ его (delete, не cancel: item возвращается в
// «незапланированное», как при возврате скипа; реальная переписка с прежним
// контактом живёт в tg_chats и НЕ теряется) и планируем свежий опенер новому
// тем же конвейером. В ОТЛИЧИЕ от доливки (scheduleDolivkaForChannel) — без
// cold-гейта (hasPendingOpeners) и без NOT-EXISTS-guard'а: это явное точечное
// действие оператора «писать теперь ему», а не пассивный добор новых. Стадию и
// repliedAt НЕ трогаем — ось воронки ортогональна оси рассылки, карточка на
// канбане остаётся где была. skipContacted=true: если новый контакт уже на
// связи в проекте (опенер по другому каналу) — не дублируем, его тред покрывает.
export async function repointPlacementSchedule(
  channelId: string,
): Promise<void> {
  const rows = await db
    .select({ item: projectItems, project: projects })
    .from(projectItems)
    .innerJoin(projects, eq(projects.id, projectItems.projectId))
    .where(
      and(
        eq(projectItems.channelId, channelId),
        inArray(projects.status, ["active", "paused"]),
        isNull(projectItems.skippedAt),
        // NB: НЕТ NOT-EXISTS-guard'а (в отличие от scheduleDolivkaForChannel) —
        // берём и уже запланированные: старый график удаляем ниже явно.
      ),
    );
  if (rows.length === 0) return;
  const byProject = Map.groupBy(rows, (r) => r.project.id);
  for (const group of byProject.values()) {
    const project = group[0]!.project;
    // Аккаунты резолвим ДО удаления: нет аккаунтов (нечем слать) → не трогаем
    // старый график, иначе лид остался бы вовсе без рассылки (а не «перепланирован»).
    const accountIds = await resolveProjectAccountIds(
      project.workspaceId,
      project,
    );
    if (accountIds.length === 0) continue;
    const itemIds = group.map((r) => r.item.id);
    // Обнуляем старый график (адресован прежнему контакту) → стандартный путь
    // планирования увидит размещения «незапланированными».
    await db
      .delete(scheduledMessages)
      .where(inArray(scheduledMessages.itemId, itemIds));
    const newRows = await scheduleLeads({
      wsId: project.workspaceId,
      project,
      accountIds,
      leads: group.map((r) => toSchedulingLead(r.item)),
      baseTime: new Date(),
      skipContacted: true,
    });
    if (newRows.length > 0) {
      await db.insert(scheduledMessages).values(newRows);
    }
  }
}

// Смена админа канала на ДРУГОГО человека (set-admin при уже привязанном
// контакте): прежний график адресован прежнему контакту — обнуляем (delete, не
// cancel: переписка с прежним живёт в tg_chats и не теряется; item → «незапла-
// нированное»). Новую серию НЕ планируем — рассылку новому админу запускает
// менеджер вручную (больше контроля; иначе на уже-продвинутых карточках
// само-взводилась пиналка). Стадию и repliedAt не трогаем — ось воронки
// ортогональна оси рассылки. В ОТЛИЧИЕ от repointPlacementSchedule (первое
// назначение) — без планирования свежего опенера.
export async function clearScheduleOnAdminChange(
  channelId: string,
): Promise<void> {
  const items = await db
    .select({ id: projectItems.id })
    .from(projectItems)
    .innerJoin(projects, eq(projects.id, projectItems.projectId))
    .where(
      and(
        eq(projectItems.channelId, channelId),
        inArray(projects.status, ["active", "paused"]),
        isNull(projectItems.skippedAt),
      ),
    );
  if (items.length === 0) return;
  await db.delete(scheduledMessages).where(
    inArray(
      scheduledMessages.itemId,
      items.map((r) => r.id),
    ),
  );
}

// ─── Этап C: ручной взвод/гашение пиналки на одном лиде ──────────────────────
// Пиналка — режим on/off на лиде (нельзя запустить две серии параллельно).
// Холодный авто-догон после опенера — это round 0; ручной взвод пишет 1,2…

// Ручное ВКЛючение пиналки на лиде (кнопка в чате). Планирует новый заход серии
// (dunning_round = max+1). Первый пинг отсчитывается от ПОСЛЕДНЕЙ активности в
// треде (наш последний sent / последнее входящее блогера) + первый интервал:
// блогер молчит дольше интервала → пинг уйдёт сразу (ближайшее рабочее окно).
// Остальные пинги довзводятся от факта отправки предыдущего (sentinel +
// scheduleNextFollowup), как холодная серия.
//
//  • "armed"   — серия запланирована;
//  • "already" — серия уже идёт (no-op, кнопка покажет «выключить»);
//  • "empty"   — планировать нечего: пиналка не настроена / нет истории отправок
//                (нет канала, с которого допинать).
export async function armLeadDunning(
  itemId: string,
): Promise<"armed" | "already" | "empty"> {
  const [item] = await db
    .select()
    .from(projectItems)
    .where(eq(projectItems.id, itemId))
    .limit(1);
  if (!item) return "empty";
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, item.projectId))
    .limit(1);
  if (!project) return "empty";
  const wsId = project.workspaceId;

  const dunning = await resolveWorkspaceDunning(wsId, project);
  if (dunning.intervals.length === 0 || dunning.pings.length === 0)
    return "empty";

  const [ws] = await db
    .select({ schedule: workspaces.outreachSchedule })
    .from(workspaces)
    .where(eq(workspaces.id, wsId))
    .limit(1);
  if (!ws) return "empty";

  // История scheduled по лиду: идёт ли серия, max round, с какого аккаунта
  // общались (+ его платформа — для котиков off на MAX) и когда последний раз слали.
  const sched = await db
    .select({
      status: scheduledMessages.status,
      messageIdx: scheduledMessages.messageIdx,
      dunningRound: scheduledMessages.dunningRound,
      accountId: scheduledMessages.accountId,
      platform: outreachAccounts.platform,
      sentAt: scheduledMessages.sentAt,
    })
    .from(scheduledMessages)
    .leftJoin(
      outreachAccounts,
      eq(outreachAccounts.id, scheduledMessages.accountId),
    )
    .where(eq(scheduledMessages.itemId, itemId));
  // Одна серия за раз: есть pending-пинг (не финальный оффер) → уже идёт.
  const armed = sched.some(
    (r) => r.status === "pending" && r.messageIdx < FINAL_OFFER_MSG_IDX,
  );
  if (armed) return "already";

  // Аккаунт — sticky-канал треда (с которого реально слали). Без истории
  // отправок допинать нечем: нет открытого канала с лидом.
  const lastSentRow = sched
    .filter((r) => r.accountId && r.sentAt)
    .sort((a, b) => b.sentAt!.getTime() - a.sentAt!.getTime())[0];
  const accountId = lastSentRow?.accountId;
  if (!accountId) return "empty";

  const round = sched.reduce((m, r) => Math.max(m, r.dunningRound), 0) + 1;

  // Последняя активность в треде = max(наш последний sent, последнее входящее
  // блогера) — та же ось, что подсветка молчунов (getLeadHealth.lastMessageAt).
  const lastSent = lastSentRow?.sentAt?.getTime() ?? 0;
  let lastInbound = 0;
  if (item.contactId) {
    const [c] = await db
      .select({ lastMessageAt: contacts.lastMessageAt })
      .from(contacts)
      .where(eq(contacts.id, item.contactId))
      .limit(1);
    lastInbound = c?.lastMessageAt?.getTime() ?? 0;
  }
  // 0 (нет истории) → от now; но история отправок тут всегда есть (accountId
  // взят из sent-строки выше), так что fallback скорее формальность.
  const activityTime = Math.max(lastSent, lastInbound) || Date.now();

  const lead = toSchedulingLead(item);
  // Имя отправителя для {{отправитель}} — по sticky-аккаунту допина (тот же, что
  // и в холодной серии: иначе переменная в ручном пинге уехала бы литералом).
  const senderName = (await resolveSenderNames([accountId])).get(accountId) ?? null;
  const subst = (t: string) =>
    substituteVariables(t, {
      username: lead.username,
      properties: lead.properties as Record<string, string>,
      senderName,
    });
  // Котики off, если допинываем через MAX-аккаунт (в MAX стикеров пиналки нет).
  // Платформу взяли тем же sched-запросом (lastSentRow) — без отдельного SELECT.
  const pingPool =
    lastSentRow?.platform === "max"
      ? dunning.pings.filter((p) => p.kind === "text")
      : dunning.pings;
  const chosen = pickPings(pingPool, dunning.intervals.length);
  if (chosen.length === 0) return "empty";

  const firstSendAt = nextAllowedSendAt(
    ws.schedule,
    new Date(activityTime + delayToMs(dunning.intervals[0]!)),
  );
  const rows: ScheduledRow[] = chosen.map((v, i) => ({
    workspaceId: wsId,
    projectId: project.id,
    itemId,
    accountId,
    messageIdx: i + 1,
    dunningRound: round,
    text: v.kind === "text" ? subst(v.text) : "",
    stickerSetName: v.kind === "sticker" ? v.setName : null,
    stickerUniqueId: v.kind === "sticker" ? v.uniqueId : null,
    // Первый пинг — от последней активности (интервал истёк → сразу). Остальные
    // довзводятся от факта отправки предыдущего (scheduleNextFollowup).
    sendAt: i === 0 ? firstSendAt : FOLLOWUP_PENDING_SENTINEL,
  }));
  await db.insert(scheduledMessages).values(rows);
  return "armed";
}

// Ручное ВЫКЛючение пиналки: гасим pending-пинги текущего захода (как ручной
// перехват в quick-send). Финальный оффер (idx 1000) не трогаем — он вне серии.
// Возвращает число погашенных пингов (0 — серия и так не шла).
export async function disarmLeadDunning(itemId: string): Promise<number> {
  const cancelled = await db
    .update(scheduledMessages)
    .set({ status: "cancelled", error: "manual dunning off" })
    .where(
      and(
        eq(scheduledMessages.itemId, itemId),
        eq(scheduledMessages.status, "pending"),
        sql`${scheduledMessages.messageIdx} < ${FINAL_OFFER_MSG_IDX}`,
      ),
    )
    .returning({ id: scheduledMessages.id });
  return cancelled.length;
}

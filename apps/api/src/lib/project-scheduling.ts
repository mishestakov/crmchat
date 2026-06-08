import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channels,
  contacts,
  outreachAccounts,
  projectItems,
  projects,
  scheduledMessages,
  tgChats,
  tgUsers,
  type ProjectMessage,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "./contact-sql.ts";
import {
  loadPropertyDefs,
  validateContactProperties,
} from "./contact-properties.ts";
import { resolveStickyByPeerIds } from "./sticky.ts";
import { substituteVariables } from "./substitute-variables.ts";

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
  // Контакт-админ канала. Нужен assignContactDefaultsAtLaunch для распределения
  // владельца на запуске. Опционален — не все вызывающие его прокидывают.
  contactId?: string | null;
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
    const priorRaw = lead.tgUserId
      ? opts.priorByTgUserId.get(lead.tgUserId)
      : undefined;
    // Sticky-аккаунт валиден только если он в наборе проекта (active ∩
    // accountsSelected). Иначе (peer общался с paused/не-выбранным аккаунтом)
    // — round-robin, а не отправка с аккаунта, которого в кампании нет.
    const prior =
      priorRaw && opts.accountIds.includes(priorRaw) ? priorRaw : undefined;
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
export async function prepareLeads(opts: {
  projectId: string;
  leads: SchedulingLead[];
  skipContacted: boolean;
}): Promise<SchedulingLead[]> {
  const channelRows = await db
    .select({
      adminUsername: projectItems.username,
      platform: channels.platform,
      channelUsername: channels.username,
      link: channels.link,
      title: channels.title,
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
  for (const r of channelRows) {
    if (!r.adminUsername) continue;
    const key = r.adminUsername.toLowerCase();
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
    if (!l.username) continue;
    const key = l.username.toLowerCase();
    if (botUsernames.has(l.username.replace(/^@/, "").toLowerCase())) continue;
    if (l.tgUserId && botTgIds.has(l.tgUserId)) continue;
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

// Распределение CRM-полей контактов на ЗАПУСКЕ кампании (а не на импорте —
// импорт каналов проект-агностичен). Для дедуплицированных по админу лидов:
// проставляет owner_id round-robin из пула проекта тем контактам, у кого его
// ещё нет (first-launch-wins — не перетираем ручное/прошлой кампании), и
// доливает contactDefaults проекта по ключам, которых у контакта нет.
// Счётчик RR (project.contactOwnerRoundRobin) сдвигаем на число реально
// назначенных владельцев. Мутирует contacts + projects. Вызывается ПОСЛЕ
// персиста scheduled_messages (best-effort): при откате активации сюда не
// доходим — контакты не получают owner'а и RR-счётчик не двигается. Запись
// идемпотентна (owner ставится только если пуст, дефолты — в отсутствующие
// ключи), так что повторный заход безопасен.
export async function assignContactDefaultsAtLaunch(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  leads: SchedulingLead[];
}): Promise<void> {
  const contactIds = [
    ...new Set(
      opts.leads
        .map((l) => l.contactId)
        .filter((id): id is string => id != null),
    ),
  ];
  if (contactIds.length === 0) return;

  const ownerIds = opts.project.contactDefaultOwnerIds;
  const projectDefaults = opts.project.contactDefaults as Record<
    string,
    unknown
  >;
  const hasOwnerPool = ownerIds.length > 0;
  const hasDefaults = Object.keys(projectDefaults).length > 0;
  if (!hasOwnerPool && !hasDefaults) return;

  const defs = await loadPropertyDefs(opts.wsId);
  const allKeys = new Set(defs.map((d) => d.key));
  const canOwner = hasOwnerPool && allKeys.has("owner_id");
  if (!canOwner && !hasDefaults) return;

  const rows = await db
    .select({ id: contacts.id, properties: contacts.properties })
    .from(contacts)
    .where(
      and(eq(contacts.workspaceId, opts.wsId), inArray(contacts.id, contactIds)),
    );
  const propsById = new Map(
    rows.map((r) => [r.id, (r.properties ?? {}) as Record<string, unknown>]),
  );

  // Итерируем contactIds в порядке лидов (не в произвольном порядке БД) — чтобы
  // round-robin владельца назначался детерминированно (первый лид → первый
  // владелец пула и т.д.). Правки считаем в памяти, пишем параллельно.
  let assigned = 0;
  const updates: { id: string; properties: Record<string, unknown> }[] = [];
  for (const id of contactIds) {
    const props = propsById.get(id);
    if (!props) continue;
    const additions: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(projectDefaults)) {
      if (props[k] === undefined && allKeys.has(k)) additions[k] = v;
    }
    if (canOwner && !props.owner_id) {
      additions.owner_id =
        ownerIds[(opts.project.contactOwnerRoundRobin + assigned) % ownerIds.length];
      assigned++;
    }
    if (Object.keys(additions).length === 0) continue;
    // Валидируем ТОЛЬКО добавляемое и мёржим в существующие props. Не прогоняем
    // хранимые props через validateContactProperties: если у контакта есть ключ
    // с удалённым позже property-def, ревалидация бросила бы 400 и уронила всю
    // активацию (additions всегда из allKeys, на них validate не падает).
    updates.push({
      id,
      properties: { ...props, ...validateContactProperties(defs, additions) },
    });
  }

  await Promise.all(
    updates.map((u) =>
      db.update(contacts).set({ properties: u.properties }).where(eq(contacts.id, u.id)),
    ),
  );

  if (assigned > 0) {
    await db
      .update(projects)
      .set({
        contactOwnerRoundRobin: sql`${projects.contactOwnerRoundRobin} + ${assigned}`,
      })
      .where(eq(projects.id, opts.project.id));
  }
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

// Чистый конвейер «лиды проекта → scheduled-строки» — общий путь активации и
// доливки: prepareLeads (дедуп по админу + синтез канало-vars) → sticky + warm
// → buildScheduledRows. Сайд-эффектов нет: возвращает строки на вставку И
// подготовленные лиды (для assignContactDefaultsAtLaunch). Распределение
// владельца вызывающий делает ПОСЛЕ персиста строк — иначе при откате
// активации контакты получили бы owner'а, а рассылка нет.
export async function scheduleLeads(opts: {
  wsId: string;
  project: typeof projects.$inferSelect;
  accountIds: string[];
  leads: SchedulingLead[];
  baseTime: Date;
  skipContacted: boolean;
}): Promise<{ rows: ScheduledRow[]; leads: SchedulingLead[] }> {
  const prepared = await prepareLeads({
    projectId: opts.project.id,
    leads: opts.leads,
    skipContacted: opts.skipContacted,
  });
  if (prepared.length === 0) return { rows: [], leads: [] };
  const tgUserIds = prepared
    .map((l) => l.tgUserId)
    .filter((x): x is string => x !== null);
  // sticky и warm независимы (общий вход tgUserIds) — параллелим.
  const [priorByTgUserId, warmTgUserIds] = await Promise.all([
    resolveStickyByTgUserIds(opts.wsId, tgUserIds),
    resolveWarmTgUserIds(opts.wsId, tgUserIds),
  ]);
  const rows = buildScheduledRows({
    wsId: opts.wsId,
    project: opts.project,
    accountIds: opts.accountIds,
    leads: prepared,
    baseTime: opts.baseTime,
    priorByTgUserId,
    warmTgUserIds,
  });
  return { rows, leads: prepared };
}

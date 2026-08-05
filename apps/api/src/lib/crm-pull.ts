// Пулл лидов из корп-CRM (specs/crm-integration.md §3.5).
//
// Направление интеграции развёрнуто (решение команды привлечения, 04.08):
// тикеты в CRM заводим НЕ мы — их льёт робот-заливщик и заводят руками
// менеджеры. Мы подтягиваем дельту (изменённое с последней сверки) в проект:
// новые тикеты становятся неразобранными лидами, у уже известных обновляется
// зеркало статуса. Если на тикете в CRM проставлен владелец — лид сразу
// закрепляется за соответствующим менеджером (users.crm_login).
//
// Текст тикета — формат робота `robot-oobp-analytics` (14 строк «Ключ:
// значение», разобран в specs/crm-integration.md). Парсим только то, что
// нужно для карточки канала и получателя.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projectItems,
  tgUsers,
  users,
} from "../db/schema.ts";
import {
  filterIssues,
  getIssueFull,
  type CrmFilteredIssue,
  type CrmIssueFull,
} from "./crm-client.ts";
import { resolveChannelIdentifier } from "./channel-providers/index.ts";
import { resolveAdminRecipient } from "./placement-recipient.ts";
import { contactUsernameLowerSql } from "./contact-sql.ts";
import { errMsg } from "./errors.ts";
import { CRM_STATE } from "@repo/core";

export type CrmPullResult = {
  /** Сколько тикетов пришло в дельте. */
  seen: number;
  /** Новых лидов создано. */
  created: number;
  /** У известных лидов обновлено зеркало статуса/владельца. */
  updated: number;
  /** Пропущено: в тикете не нашлось адреса канала. */
  skippedNoLink: number;
  /** Пропущено: полный GET тикета упал (сеть/удалён). */
  failed: number;
  /** Дельта упёрлась в лимит API (1000 без offset'а) — есть недочитанное,
   *  нужен ещё один клик «Подтянуть». */
  truncated: boolean;
};

// --- парсер текста робота ---------------------------------------------------

type ParsedTicket = {
  title: string | null;
  memberCount: number | null;
  link: string | null;
  externalId: string | null;
  adminUsername: string | null;
};

const line = (text: string, key: string): string | null => {
  const m = text.match(new RegExp(`^${key}: *(.*)$`, "m"));
  const v = m?.[1]?.trim();
  return v || null;
};

export function parseRobotTicket(text: string): ParsedTicket {
  const memRaw = line(text, "Кол-во подписчиков");
  const mem = memRaw ? Number(memRaw.replace(/\s+/g, "")) : NaN;
  const adminRaw = line(text, "Контакт в ТГ/Макс");
  return {
    title: line(text, "Название канала"),
    memberCount: Number.isFinite(mem) ? mem : null,
    link: line(text, "Ссылка"),
    externalId: line(text, "Chat_id"),
    adminUsername: adminRaw
      ? adminRaw.replace(/^@/, "").toLowerCase() || null
      : null,
  };
}

// Статус тикета → наш вердикт. «Открыт»/«В работе» → очередь разбора (pending);
// терминальные негативные исходы → дисквал; всё остальное (валидирован и дальше
// по воронке) → годен. Негативы обязаны попадать в дисквал: «годен» — это
// ворота планировщика опенеров (qualifiedSql), и тикет в «Отказе» с этим
// вердиктом получил бы холодное письмо от нас повторно.
const NEGATIVE_CRM_STATES = new Set<number>([
  CRM_STATE.disqualified,
  CRM_STATE.rejected,
  CRM_STATE.noContact,
  CRM_STATE.moderationRejected,
]);
function qualificationFromState(
  stateId: number,
): "pending" | "qualified" | "disqualified" {
  if (stateId === CRM_STATE.open || stateId === CRM_STATE.inWork) {
    return "pending";
  }
  if (NEGATIVE_CRM_STATES.has(stateId)) return "disqualified";
  return "qualified";
}

// --- сам пулл ---------------------------------------------------------------

// Лимит API filterIssues: больше за один запрос CRM не отдаёт, offset'а нет —
// базу вычитываем окнами по modified_on (см. курсор в роуте crm-pull).
const CRM_PAGE_LIMIT = 1000;
// Параллельность полных GET'ов тикетов: последовательно 1000 × ~300мс = ~5
// минут в одном HTTP-запросе (браузер оборвёт раньше). Записи в БД остаются
// последовательными — гонки «два тикета на один канал в одной пачке» не
// плодят дублей строк (уникального индекса по (project, channel) нет).
const FULL_GET_CONCURRENCY = 8;

export async function pullCrmDelta(args: {
  wsId: string;
  projectId: string;
  /** Кто нажал «подтянуть» — created_by создаваемых каналов/контактов. */
  userId: string;
  since: Date | null;
}): Promise<CrmPullResult & { maxModifiedOn: Date | null }> {
  const delta = await filterIssues(args.since);
  // Невалидная дата фильтра молча отключает окно и отдаёт весь воркфлоу —
  // единственный детектор такой аварии здесь, по аномальному объёму.
  console.log(
    `[crm-pull] delta ${delta.length} issues (since=${args.since?.toISOString() ?? "start"})`,
  );

  // Правый край обработанного окна — курсор при обрезанной дельте: двигать его
  // на «сейчас» нельзя, всё за пределами первой тысячи выпало бы навсегда.
  let maxModifiedOn: Date | null = null;
  for (const d of delta) {
    const t = d.modified_On ? new Date(d.modified_On) : null;
    if (t && !Number.isNaN(t.getTime()) && (!maxModifiedOn || t > maxModifiedOn)) {
      maxModifiedOn = t;
    }
  }

  const result: CrmPullResult & { maxModifiedOn: Date | null } = {
    seen: delta.length,
    created: 0,
    updated: 0,
    skippedNoLink: 0,
    failed: 0,
    truncated: delta.length >= CRM_PAGE_LIMIT,
    maxModifiedOn,
  };
  if (delta.length === 0) return result;

  // Известные тикеты — по всему воркспейсу, не проекту: тикет уже мог
  // приземлиться в другой проект, второй лид на тот же тикет не нужен.
  const known = await db
    .select({
      id: projectItems.id,
      crmIssueId: projectItems.crmIssueId,
      assignedTo: projectItems.assignedTo,
      qualification: projectItems.qualification,
    })
    .from(projectItems)
    .where(
      and(
        eq(projectItems.workspaceId, args.wsId),
        inArray(
          projectItems.crmIssueId,
          delta.map((d) => d.id),
        ),
      ),
    );
  const knownByIssue = new Map(known.map((k) => [k.crmIssueId!, k]));

  // Маппинг владельца: CRM отдаёт внутренний owner_id в filtered, а Login —
  // только в полном GET. Логины наших менеджеров лежат в users.crm_login.
  const managers = await db
    .select({ id: users.id, crmLogin: users.crmLogin })
    .from(users)
    .where(sql`${users.crmLogin} IS NOT NULL`);
  const userByCrmLogin = new Map(
    managers.map((m) => [m.crmLogin!.toLowerCase(), m.id]),
  );

  // Полный GET нужен новым тикетам (текст робота) и известным без закрепления
  // с владельцем в CRM (Login только в полном ответе). Тянем заранее пачками —
  // это единственная медленная часть пулла.
  const needFull = delta.filter((d) => {
    const k = knownByIssue.get(d.id);
    return !k || (!k.assignedTo && d.owner_id !== 0);
  });
  const fullById = new Map<number, CrmIssueFull>();
  for (let i = 0; i < needFull.length; i += FULL_GET_CONCURRENCY) {
    await Promise.all(
      needFull.slice(i, i + FULL_GET_CONCURRENCY).map(async (d) => {
        try {
          fullById.set(d.id, await getIssueFull(d.id));
        } catch (e) {
          // Ошибку не глотаем в null: тикет уйдёт в failed ниже, курсор не
          // двинется — следующий пулл его перечитает. Молчаливый пропуск
          // терял бы назначение менеджера из CRM навсегда.
          console.error(`[crm-pull] full GET ${d.id}: ${errMsg(e)}`);
        }
      }),
    );
  }

  for (const issue of delta) {
    const existing = knownByIssue.get(issue.id);
    const full = fullById.get(issue.id) ?? null;
    try {
      if (existing) {
        const needsOwner = !existing.assignedTo && issue.owner_id !== 0;
        if (needsOwner && !full) throw new Error("полный GET тикета упал");
        await updateKnown(existing, issue, full, userByCrmLogin);
        result.updated++;
      } else {
        if (!full) throw new Error("полный GET тикета упал");
        const outcome = await createLeadFromIssue(
          args,
          issue,
          full,
          userByCrmLogin,
        );
        if (outcome === "created") result.created++;
        else if (outcome === "attached") result.updated++;
        else result.skippedNoLink++;
      }
    } catch (e) {
      // Один битый тикет не должен ронять весь пулл; failed > 0 удерживает
      // курсор — недочитанное окно перечитается следующим кликом.
      console.error(`[crm-pull] issue ${issue.id}: ${errMsg(e)}`);
      result.failed++;
    }
  }
  return result;
}

/** Известный тикет: обновляем зеркало статуса; владельца подтягиваем только
 *  на свободный лид — закрепление, сделанное в нашем разборе, CRM не
 *  перетирает (иначе PATCH-гонки мотали бы лида между менеджерами). */
async function updateKnown(
  existing: {
    id: string;
    assignedTo: string | null;
    qualification: string;
  },
  issue: CrmFilteredIssue,
  /** Полный тикет из префетча; нужен только ради owner.Login. */
  full: CrmIssueFull | null,
  userByCrmLogin: Map<string, string>,
): Promise<void> {
  let assignedTo: string | undefined;
  if (!existing.assignedTo && issue.owner_id !== 0) {
    const login = full?.owner?.Login?.toLowerCase();
    const userId = login ? userByCrmLogin.get(login) : undefined;
    if (userId) assignedTo = userId;
  }

  // Вердикт, вынесенный в самой CRM (валидировали/дисквалифицировали руками),
  // догоняет наш pending — иначе лид вечно висит в очереди разбора и, что
  // хуже, блокирует опенер остальных каналов своего админа (pending-гейт
  // планировщика). Уже вынесенный у нас вердикт не трогаем. qualified_by
  // остаётся NULL — это машинный вердикт, как у бэкфилла.
  const pulled = qualificationFromState(issue.state_id);
  const verdictCatchup =
    existing.qualification === "pending" && pulled !== "pending"
      ? {
          qualification: pulled,
          qualReason:
            pulled === "disqualified" && issue.resolution_id !== null
              ? `${issue.state_id}_${issue.resolution_id}`
              : null,
          qualifiedAt: new Date(),
        }
      : {};

  await db
    .update(projectItems)
    .set({
      crmStateId: issue.state_id,
      crmResolutionId: issue.resolution_id,
      crmSyncedAt: new Date(),
      ...verdictCatchup,
      ...(assignedTo ? { assignedTo, assignedAt: new Date() } : {}),
    })
    .where(eq(projectItems.id, existing.id));
}

/** Новый тикет → канал (найти или создать) + лид проекта.
 *  created — лид создан; attached — канал уже был строкой проекта, доклеили
 *  зеркало тикета; no_link — в тикете нет адреса канала, лид не создан. */
async function createLeadFromIssue(
  args: { wsId: string; projectId: string; userId: string },
  issue: CrmFilteredIssue,
  full: CrmIssueFull,
  userByCrmLogin: Map<string, string>,
): Promise<"created" | "attached" | "no_link"> {
  const parsed = parseRobotTicket(full.text ?? "");
  // Адрес канала — только «Ссылка»: название в fallback нельзя — однословный
  // латинский title («CryptoNews») прошёл бы как @username и приклеил тикет
  // к чужому реальному каналу.
  const resolved = parsed.link ? resolveChannelIdentifier(parsed.link) : null;
  if (!resolved) return "no_link";

  // Канал: матч по (платформа, @username | ссылка), как в CSV-импорте, ПЛЮС
  // по Chat_id (external_id): канал мог сменить @username после заливки —
  // без этого insert упирался бы в уникальный (ws, platform, external_id),
  // а перечитка по username/link его не находила — тикет выпадал навсегда.
  const matchAddr = resolved.username
    ? sql`lower(${channels.username}) = ${resolved.username.toLowerCase()}`
    : sql`lower(${channels.link}) = ${resolved.link!.toLowerCase()}`;
  const matchCh = parsed.externalId
    ? or(matchAddr, eq(channels.externalId, parsed.externalId))
    : matchAddr;
  let [ch] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(
      and(
        eq(channels.workspaceId, args.wsId),
        eq(channels.platform, resolved.platform),
        matchCh,
      ),
    )
    .limit(1);
  if (!ch) {
    [ch] = await db
      .insert(channels)
      .values({
        workspaceId: args.wsId,
        title:
          parsed.title ||
          full.name.trim() ||
          (resolved.username ? `@${resolved.username}` : resolved.link!),
        username: resolved.username,
        link: resolved.link,
        platform: resolved.platform,
        memberCount: parsed.memberCount,
        externalId: parsed.externalId,
        createdBy: args.userId,
      })
      .onConflictDoNothing()
      .returning({ id: channels.id });
    if (!ch) {
      // Гонка с параллельным пуллом/импортом того же канала — дочитываем
      // существующий (как в campaigns bulk-add), а не роняем тикет в failed.
      [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, args.wsId),
            eq(channels.platform, resolved.platform),
            matchCh,
          ),
        )
        .limit(1);
    }
  }
  // Не нашли и не создали (конфликт по уникальному индексу, который наш матч
  // не покрывает) — честный failed: курсор удержится, тикет перечитается.
  if (!ch) throw new Error("канал не создался и не нашёлся (конфликт индекса)");

  // Админ-контакт из «Контакт в ТГ/Макс» — smart-stub как в импорте: если ник
  // знаком реплике tg_users, контакт рождается сразу с tg_user_id.
  if (parsed.adminUsername) {
    let contactId: string | null = null;
    const [existingContact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.workspaceId, args.wsId),
          sql`${contactUsernameLowerSql} = ${parsed.adminUsername}`,
        ),
      )
      .limit(1);
    if (existingContact) {
      contactId = existingContact.id;
    } else {
      const [knownTg] = await db
        .select({ userId: tgUsers.userId, fullName: tgUsers.fullName })
        .from(tgUsers)
        .where(
          and(
            eq(tgUsers.isDeleted, false),
            sql`lower(${tgUsers.username}) = ${parsed.adminUsername}`,
          ),
        )
        .limit(1);
      const props: Record<string, unknown> = {
        telegram_username: parsed.adminUsername,
        full_name: knownTg?.fullName || `@${parsed.adminUsername}`,
      };
      if (knownTg?.userId) props.tg_user_id = knownTg.userId;
      const [insContact] = await db
        .insert(contacts)
        .values({
          workspaceId: args.wsId,
          properties: props,
          createdBy: args.userId,
        })
        .onConflictDoNothing()
        .returning({ id: contacts.id });
      contactId = insContact?.id ?? null;
      if (!contactId) {
        // Гонка со вторым пуллом: контакт уже вставили — дочитываем.
        const [raced] = await db
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, args.wsId),
              sql`${contactUsernameLowerSql} = ${parsed.adminUsername}`,
            ),
          )
          .limit(1);
        contactId = raced?.id ?? null;
      }
    }
    if (contactId) {
      await db
        .insert(channelAdmins)
        .values({ channelId: ch.id, contactId })
        .onConflictDoNothing();
    }
  }

  // Получатель размещения — через единый резолвер (первый привязанный админ
  // канала), а не руками из распарсенного тикета: у существующего канала
  // админ мог быть привязан раньше и другим — строка должна указывать на
  // того же, кого выберет любой heal/repoint, иначе получатель «мигает».
  const recipient = await resolveAdminRecipient(ch.id);

  // Дубль строки в проекте (канал уже добавлен другим путём) — не плодим,
  // только доклеиваем зеркало тикета, если его не было.
  const [dupe] = await db
    .select({ id: projectItems.id })
    .from(projectItems)
    .where(
      and(
        eq(projectItems.projectId, args.projectId),
        eq(projectItems.channelId, ch.id),
      ),
    )
    .limit(1);
  if (dupe) {
    await db
      .update(projectItems)
      .set({
        crmIssueId: issue.id,
        crmStateId: issue.state_id,
        crmResolutionId: issue.resolution_id,
        crmSyncedAt: new Date(),
      })
      .where(and(eq(projectItems.id, dupe.id), isNull(projectItems.crmIssueId)));
    // Не «без ссылки»: адрес в тикете был и склейка удалась — снаружи это
    // «обновлено», иначе счётчик отправлял бы менеджера чинить целые тикеты.
    return "attached";
  }

  const ownerLogin = full.owner?.Login?.toLowerCase();
  const assignedTo = ownerLogin ? userByCrmLogin.get(ownerLogin) : undefined;
  const qualification = qualificationFromState(issue.state_id);

  await db.insert(projectItems).values({
    workspaceId: args.wsId,
    projectId: args.projectId,
    channelId: ch.id,
    contactId: recipient.contactId,
    username: recipient.username,
    tgUserId: recipient.tgUserId,
    qualification,
    qualReason:
      qualification === "disqualified" && issue.resolution_id !== null
        ? `${issue.state_id}_${issue.resolution_id}`
        : null,
    crmIssueId: issue.id,
    crmStateId: issue.state_id,
    crmResolutionId: issue.resolution_id,
    crmSyncedAt: new Date(),
    ...(assignedTo ? { assignedTo, assignedAt: new Date() } : {}),
  });
  return "created";
}

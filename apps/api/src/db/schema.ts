import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { shortId } from "./short-id.ts";

// Все PK — короткие 12-hex id (см. short-id.ts). Раньше были UUID-36, в URL'ах
// и логах слишком длинно для нашей шкалы. Тип в БД — обычный text.

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(shortId),
  tgUserId: text("tg_user_id").notNull().unique(),
  name: text("name"),
  username: text("username"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// `organizations` была удалена: внутренний CRM, биллинг/wallet/limits отсутствуют,
// единственная функция org у донора (subscription/wallet/membersCount) у нас не
// нужна. Workspace теперь top-level tenant. См. DECISIONS.md «Без organizations».

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_expires_at_idx").on(t.expiresAt)],
);

// Расписание окон отправки для outreach-воркера. Хранится на workspace, потому
// что одно на все sequences. `false` = в этот день не шлём; `{startHour,endHour}` —
// окно в часах локального tz (0..24, end эксклюзивный). Worker (фаза 3b) применяет
// его при выборе scheduled_messages для отправки в текущий момент.
export type OutreachScheduleDay = { startHour: number; endHour: number } | false;
export type OutreachSchedule = {
  timezone: string;
  dailySchedule: {
    mon: OutreachScheduleDay;
    tue: OutreachScheduleDay;
    wed: OutreachScheduleDay;
    thu: OutreachScheduleDay;
    fri: OutreachScheduleDay;
    sat: OutreachScheduleDay;
    sun: OutreachScheduleDay;
  };
};

export const DEFAULT_OUTREACH_SCHEDULE: OutreachSchedule = {
  timezone: "Europe/Moscow",
  dailySchedule: {
    mon: { startHour: 10, endHour: 20 },
    tue: { startHour: 10, endHour: 20 },
    wed: { startHour: 10, endHour: 20 },
    thu: { startHour: 10, endHour: 20 },
    fri: { startHour: 10, endHour: 20 },
    sat: false,
    sun: false,
  },
};

// Workspace.mode — единственный продуктовый тумблер «какой сценарий ведёт
// этот воркспейс». Влияет на дефолтный kind для треков/проектов/айтемов и
// на UI-лейблы конкретных страниц (не на доступность endpoint'ов).
// - bd: BD/биржевой сценарий (Саша, Perfluence, telega.in) — массовый
//   аутрич без внешнего клиента-рекла. Воронка/канбан, цепочки.
// - agency: агентский сценарий — есть клиент-рекл, медиаплан, согласование,
//   артефакты, отчёт. Outreach к блогерам — изнутри размещения.
// Default 'bd' нужен только для backfill существующих ws при db:push; в API
// CreateWorkspaceSchema требует mode явно (юзер выбирает radio при создании).
export const workspaceMode = pgEnum("workspace_mode", ["bd", "agency"]);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(shortId),
  name: text("name").notNull(),
  mode: workspaceMode("mode").notNull().default("bd"),
  outreachSchedule: jsonb("outreach_schedule")
    .$type<OutreachSchedule>()
    .notNull()
    .default(DEFAULT_OUTREACH_SCHEDULE),
  // Метадата «кто создал». В access-проверках НЕ участвует — для этого
  // workspace_members. Оставлено как audit-поле, чтобы в логах было видно
  // первого админа.
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Роль участника workspace. См. specs/permissions.md §1: две роли — admin
// (управление командой и workspace'ом) и member (полноценная работа без
// admin-actions). Третья роль chatter из донора у нас не реализована, см.
// DECISIONS.md «Workspace-роли: только admin и member».
export const workspaceRole = pgEnum("workspace_role", ["admin", "member"]);

// Membership: единственный источник истины «у кого есть доступ к workspace'у
// и в какой роли». assertMember/assertRole делают JOIN сюда. PK на паре
// (workspace_id, user_id) — один user не может состоять в одном ws дважды.
//
// Last-admin invariant (specs/permissions.md): при попытке убрать единственного
// admin'а DELETE .../members/me возвращает 409. Удалить ws целиком — отдельный
// endpoint DELETE /v1/workspaces/{wsId}.
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.workspaceId, t.userId],
      name: "workspace_members_pk",
    }),
    index("workspace_members_user_id_idx").on(t.userId),
  ],
);

// Приглашение в workspace. `code` — публичный токен (32 байта base64url) в URL
// /accept-invite/{wsId}/{code}; генерится в роуте инвайтов через
// crypto.getRandomValues, не угадывается. `telegramUsername` — hint
// пригласившему «кому я отправляю», при accept'е НЕ сверяется (любой
// залогиненный пользователь со ссылкой может принять — иначе invitee должен
// был бы менять TG-username, плохой UX). `acceptedAt`/`revokedAt` — soft-state:
// pending, если оба NULL и expiresAt > now(). Cleanup-крон отложен до prod,
// фильтруем по expires_at в queries.
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    telegramUsername: text("telegram_username").notNull(),
    role: workspaceRole("role").notNull().default("member"),
    code: text("code").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("workspace_invites_workspace_id_idx").on(t.workspaceId)],
);

// Custom-property types. По спеке data-model.md §3 — date добавим когда упрёмся.
// multi_select хранит string[] значений option.id; single_select — одно option.id.
// Аналог donor PROPERTY_METADATA. Createable (text/single_select/multi_select) — юзер
// сам создаёт через UI; остальные — только через preset-сидинг при создании workspace
// (флаг `internal`). UI отфильтровывает createable при «новое поле».
export const propertyType = pgEnum("property_type", [
  "text",
  "single_select",
  "multi_select",
  "user_select",
  "textarea",
  "url",
  "email",
  "tel",
  "number",
]);

export type PropertyValue = { id: string; name: string };

export const properties = pgTable(
  "properties",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: propertyType("type").notNull(),
    order: integer("order").notNull().default(0),
    required: boolean("required").notNull().default(false),
    showInList: boolean("show_in_list").notNull().default(true),
    // true для preset-полей, засеянных при создании workspace (full_name/email/...).
    // UI: нельзя удалить, тип фиксирован; rename/required/showInList разрешены.
    internal: boolean("internal").notNull().default(false),
    // null для скалярных типов; массив опций для single_select/multi_select.
    values: jsonb("values").$type<PropertyValue[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("properties_workspace_id_key_key").on(t.workspaceId, t.key),
    index("properties_workspace_id_idx").on(t.workspaceId),
  ],
);

export const activityType = pgEnum("activity_type", ["note", "reminder"]);
export const activityStatus = pgEnum("activity_status", ["open", "completed"]);
export const activityRepeat = pgEnum("activity_repeat", [
  "none",
  "daily",
  "weekly",
  "monthly",
]);

// Все данные контакта — в `properties` jsonb. Системные поля (full_name, email,
// phone, url, amount, telegram_username, description, stage) сидятся как preset
// properties при создании workspace; кастомные поля юзера лежат тут же. Структура
// 1:1 с donor (за вычетом avatarUrl).
export const contacts = pgTable(
  "contacts",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    properties: jsonb("properties")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Счётчик непрочитанных сообщений в TG-чате с этим контактом. Инкрементит
    // outreach-listener (входящее DM от tg_user_id, который у нас в contacts);
    // обнуляется явным POST /read из фронта (открыли чат / TWA-iframe прислал
    // chatRead postMessage).
    unreadCount: integer("unread_count").notNull().default(0),
    // Время последнего входящего сообщения от контакта — для сортировки кoлонок
    // канбана «свежий ответ сверху» в будущем + для UI-подсказок «X мин назад».
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    // Sticky закрепление контакта за outreach-аккаунтом: «кто первый написал —
    // тот и продолжает». First-write-wins: проставляется на импорте DM, на
    // первой исходящей рассылке и на первом входящем DM, но никогда не
    // переписывается (sticky при загрузке нового CSV сначала смотрит сюда —
    // см. outreach-sequences.ts). ON DELETE SET NULL: удалили аккаунт →
    // sticky сбрасывается, и резолвер выбирает аккаунт заново.
    primaryAccountId: text("primary_account_id").references(
      () => outreachAccounts.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_workspace_id_idx").on(t.workspaceId),
    // Functional-индекс под dedup при TG-импорте: lookup
    // `properties->>'tg_user_id'` иначе full scan по всей таблице.
    index("contacts_tg_user_id_idx").on(
      sql`(${t.properties} ->> 'tg_user_id')`,
    ),
    // UNIQUE на пару (workspace, tg_user_id) — закрывает race в outreach
    // listener'е: два concurrent NewMessage events могли создать двух контактов
    // для одного TG-юзера (find-or-create в разных запросах). Partial index:
    // контакты без tg_user_id (созданные руками) не попадают под constraint.
    uniqueIndex("contacts_workspace_tg_user_id_unique")
      .on(t.workspaceId, sql`(${t.properties} ->> 'tg_user_id')`)
      .where(sql`(${t.properties} ->> 'tg_user_id') IS NOT NULL`),
    // UNIQUE на (workspace, lower(telegram_username)) — нужен для stub-контактов
    // из импорта лидов / channels (созданы без tg_user_id, только @username).
    // Чтобы второй импорт того же @vasya подцепился к существующему stub'у,
    // а не плодил дубли. На lazy-резолве tg_user_id stub доукомплектуется и
    // переезжает под первый unique, этот остаётся «бесполезным» (но не мешает).
    uniqueIndex("contacts_workspace_username_unique")
      .on(
        t.workspaceId,
        sql`lower(${t.properties} ->> 'telegram_username')`,
      )
      .where(sql`(${t.properties} ->> 'telegram_username') IS NOT NULL`),
  ],
);

// Outreach-аккаунт: ОТПРАВЛЯЮЩИЙ TG-аккаунт для холодных рассылок.
//   - Multi per workspace (не unique по чему-либо identifying).
//   - Жизненный цикл: расходник; при бане — заводят новый.
//   - Worker MTProto-state (TDLib binlog) живёт per-account в
//     `td-database/outreach/<accountId>/`.
//   - iframe_session — ВТОРОЙ независимый MTProto auth_key для TWA-iframe:
//     зашифрованный JSON `{ mainDcId, keys: { [dcId]: hex } }`. Создаётся
//     при persist'e через временный TDLib инстанс +
//     confirmQrCodeAuthentication (см. lib/tdlib/provision-iframe-session.ts).
//     Один auth_key для worker и iframe не подходит: TG распределяет updates
//     на активную сессию, и при открытом iframe worker молчит — теряем
//     incoming/read events.
//   - TODO фаза 4: proxy_id, warmup_*, bucket, transport, daily_limit.
export const outreachAccountStatus = pgEnum("outreach_account_status", [
  "active",
  "banned",
  "unauthorized",
]);

export const outreachAccounts = pgTable(
  "outreach_accounts",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: outreachAccountStatus("status").notNull().default("active"),
    // Зашифрованный JSON `{ mainDcId, keys: { [dcId]: hex } }`. NULL'ом сидит
    // только короткий момент между INSERT row и success'ным
    // provisionIframeSession; после провижна — заполнен. Если так и остался
    // NULL (provision упал) — UI зовёт /twa-session, ловит 409 и просит
    // re-auth.
    iframeSession: text("iframe_session"),
    // session_id (TG int64) iframe-сессии, возвращённый
    // confirmQrCodeAuthentication. Используется при удалении аккаунта для
    // точечного terminateSession({session_id}) — иначе пришлось бы искать
    // по device_model="CRM iframe" через getActiveSessions, что fragile при
    // повторных привязках (висящие старые сессии с тем же device_model).
    iframeSessionId: text("iframe_session_id"),
    tgUserId: text("tg_user_id").notNull(),
    tgUsername: text("tg_username"),
    phoneNumber: text("phone_number"),
    firstName: text("first_name"),
    hasPremium: boolean("has_premium").notNull().default(false),
    // Лимит исходящих сообщений в сутки на этот аккаунт. Worker (фаза 3b)
    // считает sent-за-сегодня и пропускает аккаунт когда упёрлись. Дефолт 15 —
    // консервативный уровень из касдева Юли (10 безопасно, 15 ещё ОК, выше
    // растёт риск жалобы → блок). Юзер может крутить.
    newLeadsDailyLimit: integer("new_leads_daily_limit").notNull().default(15),
    // FloodWait cooldown — аккаунт молчит до этой даты. Заполняется worker'ом
    // и quick-send'ом при FloodWaitError. Сохраняется в БД (а не in-memory),
    // чтобы переживало рестарт API и показывалось менеджеру в UI («аккаунт
    // молчит до 14:23»). Очищается на следующей успешной отправке.
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    cooldownReason: text("cooldown_reason"),
    // Текущий владелец аккаунта (менеджер). Меняется через transfer
    // (увольнение/перепередача). Member видит аккаунт если owner_user_id=self
    // или есть активная делегация (см. outreach_account_delegations).
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    // Audit: кто изначально подключил. Не участвует в access-проверках.
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_accounts_workspace_id_idx").on(t.workspaceId),
    index("outreach_accounts_owner_idx").on(t.workspaceId, t.ownerUserId),
    // Один и тот же TG-аккаунт нельзя добавить в один workspace дважды.
    unique("outreach_accounts_workspace_tg_unique").on(
      t.workspaceId,
      t.tgUserId,
    ),
  ],
);

// Временная передача доступа к аккаунту без смены владельца — отпуск,
// больничный. Owner остаётся прежним; delegate видит аккаунт и его чаты
// пока now() ∈ [starts_at, ends_at). Окончание — автоматическое по дате,
// никаких обратных операций. Перманентная передача (увольнение) делается
// через UPDATE outreach_accounts.owner_user_id (transfer endpoint).
//
// PK (account, delegate, starts_at) — один и тот же делегат может иметь
// несколько окон в разное время.
export const outreachAccountDelegations = pgTable(
  "outreach_account_delegations",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => outreachAccounts.id, { onDelete: "cascade" }),
    delegateId: text("delegate_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // NULL = бессрочное (редкий кейс, например постоянная подмена).
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // Свободный текст для UI: 'отпуск', 'больничный', etc.
    reason: text("reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.accountId, t.delegateId, t.startsAt],
      name: "outreach_account_delegations_pk",
    }),
    // Под лукап «активные делегации этого юзера» при listing'е аккаунтов.
    index("outreach_account_delegations_delegate_idx").on(t.delegateId),
  ],
);

// Outreach-специфичные enum'ы для project (kind='outreach').
export const outreachAccountsMode = pgEnum("outreach_accounts_mode", [
  "all",
  "selected",
]);
// Иерархия Track → Project → Item. Общая для двух юз-кейсов:
// (1) BD-команда: Track=программа («Привлечение/Удержание/Отток»),
//     Project=инстанс программы за период, Item=лид.
// (2) Агентство: Track=клиент (Coca-Cola), Project=кампания (Q4 Holiday),
//     Item=размещение (channel × project × date).
// Тип сущности задаёт workspace.mode (первичный тумблер сценария). На уровне
// project/item discriminator всё же нужен (project_item_kind: lead vs placement
// разводит outreach- и agency-логику). У track'а отдельного kind НЕТ — папка
// одинакова в обоих сценариях, mode уже всё разводит.
// Соответствие: mode='bd' → outreach/lead; mode='agency' → agency/placement.

export const projectKind = pgEnum("project_kind", ["outreach", "agency"]);

// draft → active ↔ paused → done → archived. archived проекты скрыты из
// основного listing'а; вытащить из архива пока нельзя (или через прямой
// URL по id). Возможно потом авто-архивация done через месяц.
export const projectStatus = pgEnum("project_status", [
  "draft",
  "active",
  "paused",
  "done",
  "archived",
]);

export const projectItemKind = pgEnum("project_item_kind", [
  "lead",
  "placement",
]);

// Фаза agency-кампании — стадия воронки в визарде (бриф → лонглист →
// согласование → финальный оффер → производство → отчёт). Свободная
// навигация: phase — это «где основная работа сейчас» + дефолтный экран и
// бейдж в списке, НЕ машина состояний (экраны доступны в любом порядке).
// Для bd-проектов поле не используется (остаётся 'briefing' по дефолту).
export const projectPhase = pgEnum("project_phase", [
  "briefing",
  "longlist",
  "review",
  "shortlist",
  "production",
  "wrapup",
]);

// Решение клиента по строке медиаплана (project_items kind='placement').
// Проставляется клиентом через magic-link (этап согласования, отдельный PR);
// в лонглист-PR колонка заводится со значением 'pending' и пока не меняется.
export const placementClientStatus = pgEnum("placement_client_status", [
  "pending",
  "approved",
  "rejected",
]);

// Этапы производства размещения (фаза 5, drawer-stepper). Проставляются
// менеджером вручную; файлы-артефакты (placement_files) — отдельный этап.
export const placementContractStatus = pgEnum("placement_contract_status", [
  "none", // не отправлен
  "sent", // отправлен блогеру
  "revising", // блогер вносит правки
  "signed", // подписан с двух сторон
]);
export const placementCreativeStatus = pgEnum("placement_creative_status", [
  "none",
  "awaiting", // ждём драфт от блогера
  "internal_review", // агентство проверяет на соответствие ТЗ
  "client_review", // отправлено клиенту на ОК
  "revising", // правки
  "approved", // клиент одобрил
]);

// Снятие метрик опубликованного поста (фаза «Отчёт»). Менеджер жмёт «снять
// статистику» → размещение уходит в pending → metrics-worker разбирает
// очередь (троттл) и проставляет done/error. idle = ещё не снимали.
export const placementMetricsStatus = pgEnum("placement_metrics_status", [
  "idle",
  "pending",
  "done",
  "error",
]);

// Track — родительская «папка» проектов. У BD-команды: «Привлечение»,
// «Удержание», «Отток», «Ad-hoc». У агентства: «Coca-Cola», «Beeline».
// Спец-поля типа ИНН/договора (для клиента-агентства) живут в `properties`.
export const tracks = pgTable(
  "tracks",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    properties: jsonb("properties")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tracks_workspace_id_idx").on(t.workspaceId)],
);

// Stage template — переиспользуемый шаблон стадий канбана на воркспейс.
// При создании проекта стадии копируются из template.stages; правка
// шаблона существующие проекты не трогает (однонаправленное копирование).
// Видимость: все member'ы; CRUD — admin.
export const stageTemplates = pgTable(
  "stage_templates",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    stages: jsonb("stages").$type<ProjectStage[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stage_templates_workspace_id_idx").on(t.workspaceId)],
);

// Message template — переиспользуемая цепочка сообщений на воркспейс.
// При создании проекта или по кнопке «Сохранить как шаблон» юзер
// складывает текущие project.messages в библиотеку; при создании следующего
// проекта выбирает из селекта и messages копируются в новый проект.
// Дальше шаблон и проект развязаны (правка одного не трогает другого).
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    messages: jsonb("messages").$type<ProjectMessage[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("message_templates_workspace_id_idx").on(t.workspaceId)],
);

export type ProjectMessageDelay = {
  // 'minutes' нужен для тестов/демо; в проде разумно 'hours'/'days'.
  period: "minutes" | "hours" | "days";
  value: number;
};
export type ProjectMessage = {
  id: string;
  text: string;
  // Альтернативный текст для «тёплых» лидов — тех, кто хотя бы раз отвечал
  // на наш DM через любой аккаунт воркспейса (tg_chats.has_inbound=true).
  // Сейчас редактируется только у первого шага (idx=0); валидация на это
  // не накладывается, но активация применяет warmText только для idx=0.
  // null/undefined/"" → tёплый получает основной text.
  warmText?: string | null;
  // Задержка ОТНОСИТЕЛЬНО предыдущего сообщения этого же project'а для лида.
  // Для первого сообщения (idx=0) — относительно момента активации.
  delay: ProjectMessageDelay;
};

// Стадия канбана проекта. У каждого проекта свой набор stages — JSON-массив
// на projects.stages, без отдельной таблицы. project_items.stage_id (text)
// ссылается на id из json'а без FK; удаление стадии «сиротит» карточки.
export type ProjectStage = {
  id: string;
  name: string;
  order: number;
};

// Default-набор стадий для outreach-проекта при создании, если юзер ничего
// не указал. После создания юзер может переименовать/добавить/удалить.
export const DEFAULT_OUTREACH_STAGES: ProjectStage[] = [
  { id: "new", name: "Новый", order: 0 },
  { id: "in_progress", name: "В работе", order: 1 },
  { id: "replied", name: "Ответил", order: 2 },
  { id: "done", name: "Закрыт", order: 3 },
];

// Project — единица работы с собственным канбаном. Outreach-проект
// содержит цепочку сообщений + лидов; agency-проект — медиаплан размещений.
//
// Outreach-specific колонки (accounts_mode/messages/contact_*) валидны
// только при kind='outreach'; для других kind'ов остаются дефолтными
// и не используются API/worker'ом.
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    trackId: text("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: projectKind("kind").notNull().default("outreach"),
    status: projectStatus("status").notNull().default("draft"),
    properties: jsonb("properties")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Стадии канбана проекта. Default — DEFAULT_OUTREACH_STAGES. Удаление
    // стадии не каскадит — карточки «сиротеют» (UI рисует «Без стадии»).
    stages: jsonb("stages")
      .$type<ProjectStage[]>()
      .notNull()
      .default([]),

    // === agency-specific (kind='agency') ===================================
    // Используются только в agency-визарде (медиаплан). В bd-проектах остаются
    // дефолтными и не отображаются. Все brief-поля nullable — заполняются по
    // мере того как менеджер разбирается с кампанией (спека §3.2).

    phase: projectPhase("phase").notNull().default("briefing"),
    brief: text("brief"),
    budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    tov: text("tov"),
    constraints: text("constraints"),
    // Клиент финализировал медиаплан по своей magic-link: с этого момента он
    // больше не меняет решения (фаза «Согласование» заморожена). Менеджер может
    // переоткрыть из кабинета (обнулить) — тогда клиент снова правит.
    clientFinalizedAt: timestamp("client_finalized_at", { withTimezone: true }),

    // === outreach-specific =================================================

    accountsMode: outreachAccountsMode("accounts_mode").notNull().default("all"),
    accountsSelected: jsonb("accounts_selected")
      .$type<string[]>()
      .notNull()
      .default([]),
    messages: jsonb("messages")
      .$type<ProjectMessage[]>()
      .notNull()
      .default([]),
    contactDefaultOwnerIds: jsonb("contact_default_owner_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    contactDefaults: jsonb("contact_defaults")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    contactOwnerRoundRobin: integer("contact_owner_round_robin")
      .notNull()
      .default(0),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_workspace_id_idx").on(t.workspaceId),
    index("projects_track_id_idx").on(t.trackId),
  ],
);

// Project import — лог CSV-импортов в проект. Нужен, чтобы видеть какие
// батчи приходили и когда (для «доливки лидов»).
export type ProjectImportSourceMeta = {
  fileName?: string;
  usernameColumn?: string;
  // CSV-колонка с @username канала, который ведёт лид. На импорте такие
  // каналы upsert'ятся в `channels` и связываются с контактом через
  // `channel_admins`. Цель — один залив CSV даёт и лидов, и карточки каналов
  // в `/channels`. Минимум полей: только username; title/member_count
  // заполнятся при первом sync'е из соцсети.
  channelUsernameColumn?: string;
  columns?: string[];
};

export type ProjectImportStats = {
  imported: number;
  skippedMissingIdentifier: number;
  skippedDuplicate: number;
  // Сколько лидов узнали в существующих contacts (sticky подхватит).
  recognized?: number;
};

export const projectImports = pgTable(
  "project_imports",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceMeta: jsonb("source_meta")
      .$type<ProjectImportSourceMeta>()
      .notNull()
      .default({}),
    importStats: jsonb("import_stats").$type<ProjectImportStats>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_imports_project_id_idx").on(t.projectId)],
);

// Ссылка на помеченное сообщение в чате с админом (фаза «Запуск»): договор,
// креатив, акт. Файлы НЕ храним — только ссылку, рендерим на лету из TDLib.
// messageIds — список, т.к. альбом (10 фото) = N сообщений с общим media_album_id
// (td_api.tl §message.media_album_id); фронт собирает их из загруженной истории.
// accountId — через какой аккаунт открыт диалог (им же читаем сообщение позже).
export type PlacementMsgRef = {
  chatId: string;
  messageId: string; // помеченное сообщение (для альбома — любое из него)
  albumId: string | null; // media_album_id != "0" → сервер дочитает весь альбом
  accountId: string;
  at: string; // ISO — когда пометили
};
export type PlacementStepMessages = {
  contract?: PlacementMsgRef;
  creative?: PlacementMsgRef;
  act?: PlacementMsgRef;
};

// Project item — карточка на канбане проекта. Lead (контакт-в-задаче) или
// placement (channel-в-проекте).
export const projectItems = pgTable(
  "project_items",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // FK на batch CSV-импорта, из которого пришёл item. NULL — item создан
    // вручную или доливкой без batch-меток. ON DELETE SET NULL: запись
    // импорта могут удалить, item остаётся.
    importId: text("import_id").references(() => projectImports.id, {
      onDelete: "set null",
    }),
    kind: projectItemKind("kind").notNull().default("lead"),
    // Текущая стадия канбана. text — id из projects.stages[*].id, без FK
    // (stages — json на проекте). null = «без стадии»; новые лиды лучше
    // создавать с stage_id первой стадии (см. project-imports.ts), но
    // явно null остаётся валидным для UI «Без стадии».
    stageId: text("stage_id"),

    // === lead-specific (kind='lead') =======================================

    username: text("username"),
    tgUserId: text("tg_user_id"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),

    properties: jsonb("properties")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),

    // === placement-specific (kind='placement') =============================
    // Строка медиаплана = «выход поста у одного блогера в кампании». Аутрич по
    // лонглисту переиспользует lead-поля выше (username/tg_user_id/contact_id
    // резолвятся от админа канала), а эти поля держат данные размещения.
    // Поля публикации/метрик/ЕРИД (published_at, actual_*, erid) добавятся в
    // PR производства — не часть data shape лонглиста.
    channelId: text("channel_id").references(() => channels.id, {
      onDelete: "cascade",
    }),
    // Результат лонглист-аутрича: блогер готов сотрудничать? Заполняется
    // менеджером по ответу (null = ещё не знаем, true/false = готов/отказ).
    // По нему рекл шортлистит на согласовании.
    available: boolean("available"),
    priceAmount: numeric("price_amount", { precision: 12, scale: 2 }),
    // Цена для клиента (наценка). null = «совпадает с priceAmount» — клиент
    // видит ту же сумму. Менеджер задаёт иную, если в клиентской ссылке нужна
    // другая цена, чем закупочная у блогера.
    clientPrice: numeric("client_price", { precision: 12, scale: 2 }),
    forecastViews: integer("forecast_views"),
    forecastErr: numeric("forecast_err", { precision: 5, scale: 2 }),
    clientStatus: placementClientStatus("client_status")
      .notNull()
      .default("pending"),
    // Комментарий клиента к решению (необязателен, шлётся с любым статусом) +
    // когда проставил. Заполняются из клиентского magic-link view.
    clientStatusComment: text("client_status_comment"),
    clientStatusAt: timestamp("client_status_at", { withTimezone: true }),
    // Когда менеджер добавил размещение в шортлист (явная кнопка «В шортлист»).
    // null = ещё в лонглисте-опросе; not null = собран, ушёл в шортлист
    // (показывается клиенту, виден на фазе согласования).
    shortlistedAt: timestamp("shortlisted_at", { withTimezone: true }),

    // === production (фаза 5) ===============================================
    // Когда отправлен финальный оффер «вы выбраны» (bulk-send по шортлисту).
    finalOfferSentAt: timestamp("final_offer_sent_at", { withTimezone: true }),
    contractStatus: placementContractStatus("contract_status")
      .notNull()
      .default("none"),
    creativeStatus: placementCreativeStatus("creative_status")
      .notNull()
      .default("none"),
    creativeRound: integer("creative_round").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    erid: text("erid"),
    eridAdvertiserData: text("erid_advertiser_data"),
    postUrl: text("post_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    actReceivedAt: timestamp("act_received_at", { withTimezone: true }),
    // Помеченные сообщения в чате (договор/креатив/акт) — ссылки, не файлы.
    stepMessages: jsonb("step_messages").$type<PlacementStepMessages>(),
    // Когда ЕРИД отправлен блогеру в чат (кнопка «Отправить»). Повторяемо.
    eridSentAt: timestamp("erid_sent_at", { withTimezone: true }),
    // Комментарий клиента к креативу (запрос правок) из клиентского портала —
    // Фаза B (клиентское согласование креативов). Shape сразу финальный.
    creativeClientComment: text("creative_client_comment"),

    // Фаза «Отчёт»: снимок поста, снятый metrics-worker'ом через TDLib.
    // postSnapshot — текст + минитамбнейл (base64 jpeg из payload, без
    // downloadFile), используется как «карточка поста» в отчёте.
    metricsStatus: placementMetricsStatus("metrics_status")
      .notNull()
      .default("idle"),
    metricsViews: integer("metrics_views"),
    metricsForwards: integer("metrics_forwards"),
    metricsReactions: integer("metrics_reactions"),
    metricsCollectedAt: timestamp("metrics_collected_at", { withTimezone: true }),
    metricsError: text("metrics_error"),
    postSnapshot: jsonb("post_snapshot").$type<{
      text: string;
      thumbB64: string | null;
      thumbW: number | null;
      thumbH: number | null;
    }>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_items_project_id_idx").on(t.projectId),
    // Под медиаплан-лукап и историю цен по каналу (kind='placement').
    index("project_items_channel_id_idx").on(t.channelId),
    index("project_items_workspace_id_idx").on(t.workspaceId),
    // Под inbound-listener: lookup `WHERE workspace_id = ? AND tg_user_id = ?`.
    index("project_items_workspace_tg_user_id_idx").on(
      t.workspaceId,
      t.tgUserId,
    ),
    // Identity-уникальность лидов в одном проекте: @username — единственный
    // TG-идентификатор, по которому импорт может найти и отправить DM.
    uniqueIndex("project_items_project_username_unique")
      .on(t.projectId, sql`lower(${t.username})`)
      .where(sql`${t.username} IS NOT NULL AND ${t.kind} = 'lead'`),
  ],
);

// Запланированное сообщение outreach-проекта: одна строка = одна предстоящая
// отправка. Создаётся пачкой при активации проекта (item × message_idx).
// `text` — snapshot ПОСЛЕ подстановки {{key}} переменных, чтобы редактирование
// project.messages не порвало уже распланированное.
//   pending → sent | failed | cancelled
// Worker (фаза 3b) выбирает pending где sendAt <= now AND respect schedule.
export const scheduledMessageStatus = pgEnum("scheduled_message_status", [
  "pending",
  "sent",
  "failed",
  "cancelled",
]);

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => projectItems.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => outreachAccounts.id, { onDelete: "cascade" }),
    messageIdx: integer("message_idx").notNull(),
    text: text("text").notNull(),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    status: scheduledMessageStatus("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    // Когда лид прочитал наше сообщение (TG прислал UpdateReadHistoryOutbox).
    // NULL пока не прочитано. Гранулярность — message-уровень не строгая: TG
    // даёт max_id, мы помечаем все исходящие в этом диалоге как прочитанные
    // (для агрегата read-rate этого достаточно).
    readAt: timestamp("read_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scheduled_messages_project_id_idx").on(t.projectId),
    index("scheduled_messages_item_id_idx").on(t.itemId),
    // Composite-индекс под главный запрос воркера: pending по sendAt asc.
    index("scheduled_messages_worker_pick_idx").on(t.status, t.sendAt),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: activityType("type").notNull(),
    text: text("text").notNull(),
    // date актуально только для type='reminder'; для 'note' — null
    date: timestamp("date", { withTimezone: true }),
    repeat: activityRepeat("repeat").notNull().default("none"),
    status: activityStatus("status").notNull().default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_contact_id_idx").on(t.contactId)],
);

// channels — площадки (TG-каналы/группы и в будущем MAX), которыми занимается
// бизнес. Связь с админом — через channel_admins (m:n: один канал может
// иметь несколько админов; один контакт может админить несколько каналов).
//
// Раскладка по правилу «единый источник истины — соцсеть» (см. plan §11.6):
//   - Колонки = универсальные поля (есть в любой соцсети): title, description,
//     username, link, member_count, external_id (id канала в его соцсети).
//   - `meta` jsonb = proprietary поля конкретной соцсети (TG-specific:
//     boost_level, is_verified, has_dm, supergroup_id, linked_chat_id,
//     gift_count, photo_*_id, …). При появлении MAX — туда же ляжет MAX-их
//     специфика.
//   - `properties` jsonb = наши computed/csv-импорт поля, которые соцсеть
//     не отдаёт (ER, ниша, is_rkn, теги). Соцсетевой pull их НЕ ТРОГАЕТ.
//
// `synced_at` — общий timestamp последнего pull'а из соцсети. NULL = ни разу
// не синхронизировались, CSV-импорт пишет всё. NOT NULL = свежие данные из
// соцсети, CSV пишет только properties + admin_username (TG этого не знает).
export const channelPlatform = pgEnum("channel_platform", ["telegram", "max"]);

export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    platform: channelPlatform("platform").notNull().default("telegram"),
    // ID канала в его соцсети. Для TG — `chat_id` формата `-100…`. Для MAX —
    // что-то своё. uniq на (ws, platform, external_id) WHERE NOT NULL.
    externalId: text("external_id"),
    title: text("title").notNull(),
    description: text("description"),
    // Публичный @handle без `@`, в исходном регистре. uniq делается по
    // lower() для case-insensitive дедупа.
    username: text("username"),
    link: text("link"),
    memberCount: integer("member_count"),
    // Proprietary поля соцсети (TG: boost_level, is_verified, has_dm,
    // supergroup_id, linked_chat_id, photo_small_id, gift_count, …).
    // JSONB-merge ('meta || patch'): sync endpoint пишет свои поля синхронно,
    // tg-replicator ловит updateSupergroup и докладывает nice-to-have в фоне.
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    // Наши/CSV-импорт поля, которых нет в соцсети (ER, ниша, is_rkn).
    // НЕ трогается соц-pull'ом.
    properties: jsonb("properties")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    // since — первая неудача (COALESCE при retry'ях, чтобы не терять «X
    // дней назад начало»). last_check_at — обновляется каждой попыткой,
    // от него отсчитывается 1h-cooldown в channels.ts.
    unavailableSince: timestamp("unavailable_since", { withTimezone: true }),
    unavailableLastCheckAt: timestamp("unavailable_last_check_at", {
      withTimezone: true,
    }),
    unavailableReason: text("unavailable_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channels_workspace_id_idx").on(t.workspaceId),
    // Дедуп при повторном CSV-импорте по ID в соцсети.
    uniqueIndex("channels_workspace_platform_external_id_unique")
      .on(t.workspaceId, t.platform, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    // Второй идентификатор — публичный @handle, регистр-независимо.
    uniqueIndex("channels_workspace_platform_username_unique")
      .on(t.workspaceId, t.platform, sql`lower(${t.username})`)
      .where(sql`${t.username} IS NOT NULL`),
    // Lookup от tg-replicator updateSupergroup-handler'а: cold-start TDLib
    // пушит десятки/сотни updateSupergroup, на каждый flush идёт UPDATE
    // WHERE meta->>'supergroup_id' = $1. Без index'а — full scan на каждый.
    index("channels_meta_supergroup_id_idx").on(
      sql`(${t.meta}->>'supergroup_id')`,
    ),
  ],
);

// Кеш minithumbnail (base64 jpeg ~200B) из соцсети — лежит отдельной
// таблицей, чтобы list-запросы по channels не тащили лишние ~3MB на 14k
// каналов. JOIN'им только там, где UI реально показывает превью.
// Расширение под полноразмерные аватарки (small_path/big_path для
// downloadFile) — добавится сюда же отдельным этапом.
export const channelThumbnails = pgTable("channel_thumbnails", {
  channelId: text("channel_id")
    .primaryKey()
    .references(() => channels.id, { onDelete: "cascade" }),
  b64: text("b64").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const channelAdmins = pgTable(
  "channel_admins",
  {
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.contactId], name: "channel_admins_pk" }),
    // Под обратный lookup «какие каналы у этого контакта».
    index("channel_admins_contact_id_idx").on(t.contactId),
  ],
);

// channel_subscriptions — подписка outreach-аккаунта на TG-канал.
// Источник истины: сделана через наш subscribe endpoint (joinChat /
// joinChatByInviteLink) или явно зарегистрирована. Не пытаемся отражать
// подписки «снаружи CRM» (с телефона/TWA) — пока менеджер не нажмёт
// «Подписаться» в нашем UI, мы считаем что аккаунт не подписан.
//
// Используется в /channels/{id}/history: первый приоритет — читаем через
// любой подписанный аккаунт (для приватных каналов это единственный способ).
// Fallback — pickOutreachClient через свой аккаунт (для публичных каналов
// работает без подписки).
export const channelSubscriptionStatus = pgEnum(
  "channel_subscription_status",
  ["subscribed", "pending"],
);

export const channelSubscriptions = pgTable(
  "channel_subscriptions",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => outreachAccounts.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    // 'subscribed' — joinChat вернул Ok, аккаунт в канале.
    // 'pending' — joinChat вернул INVITE_REQUEST_SENT, ждём подтверждения
    // админа канала. Read через такой аккаунт не сработает.
    status: channelSubscriptionStatus("status").notNull().default("subscribed"),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.accountId, t.channelId],
      name: "channel_subscriptions_pk",
    }),
    // Обратный lookup «кто подписан на этот канал» для pickChannelReader.
    index("channel_subscriptions_channel_id_idx").on(t.channelId),
  ],
);

// === TG-репликация (этап 9.2) ===
// Локальная копия Telegram chat list / user directory, обновляемая push'ом
// через client.on('update'). Read-сценарии (поиск контактов, импорт, аналитика)
// идут SQL'ом вместо RPC. См. tg-replicator.ts.
//
// Скоп: только private DM с реальными юзерами (chatTypePrivate, userTypeRegular).
// Группы/каналы/секретные/боты/удалённые не реплицируем — CRM в них не работает.

// tg_chats — per-account private DM. Один и тот же блогер у двух наших
// аккаунтов = две строки с разным account_id.
export const tgChats = pgTable(
  "tg_chats",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => outreachAccounts.id, { onDelete: "cascade" }),
    chatId: text("chat_id").notNull(),
    peerUserId: text("peer_user_id").notNull(),
    lastMessageId: text("last_message_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    // Время последнего входящего (is_outgoing=false) от peer'а в этот аккаунт.
    // Source-of-truth для sticky-резолвера v2 («кто последним получил ответ»):
    // победитель — аккаунт с MAX(last_inbound_at) среди воркспейса.
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    // Время последнего исходящего (is_outgoing=true) от нашего аккаунта peer'у.
    // Для UI правой панели «N раз писали, ответов нет» (10.7) и аналитики
    // «активность аккаунта в DM».
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    // Слабый сигнал «когда-то был входящий» — для случаев когда last_message
    // у нас исходящее, но раньше peer отвечал. TDLib даёт это через
    // `last_read_inbox_message_id > 0` или `unread_count > 0` в chat payload,
    // дату при этом не возвращает. Используется sticky-резолвером как
    // fallback (Уровень 2): если ни у кого нет точного last_inbound_at, но
    // у кого-то has_inbound=true — выигрывает свежайший last_message_at среди них.
    hasInbound: boolean("has_inbound").notNull().default(false),
    // ID последнего сообщения, которое peer у нас прочитал. Из chat payload
    // (initial chat list) + updateChatReadOutbox. Drawer рендерит ✓/✓✓:
    // если message.id <= lastReadOutboxId → peer прочитал (двойная галочка).
    lastReadOutboxId: text("last_read_outbox_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.chatId], name: "tg_chats_pk" }),
    // Под sticky lead assignment и поиск «кто из наших общался с peer_user_id».
    index("tg_chats_peer_user_id_idx").on(t.peerUserId),
    // Под фильтр «диалоги аккаунта, отсортированные по свежести» — импорт-флоу
    // 9.4 («все собеседники последних 30 дней»).
    index("tg_chats_account_last_msg_idx").on(t.accountId, t.lastMessageAt),
    // Под sticky-резолвер v2: WHERE peer_user_id IN (...) AND last_inbound_at
    // IS NOT NULL ORDER BY last_inbound_at DESC.
    index("tg_chats_peer_inbound_idx").on(t.peerUserId, t.lastInboundAt),
  ],
);

// Группы НЕ реплицируем (этап 16.9 ревизия): они личные и эфемерные, в нашу БД
// не оседают. Пикер привязки группы читает их live через TDLib (searchChats +
// getChat, offline), чат группы тоже идёт live. Приватнее и без рассинхрона.

// tg_users — глобальный словарь TG-собеседников. Реплицируем Regular + Bot
// (этап 16.9: бот = способ связи, ~25% контактов) + Deleted/Unknown.
// is_bot — авторитетный флаг (userTypeBot), по нему авто-рассылка пропускает
// ботов и worker не шлёт им опенер. Суффикс @username больше не используем
// (резал живых @talbot/@robot).
//
// is_deleted=true для userTypeDeleted/Unknown — TG отозвал юзера или потерял
// к нему доступ. Строку НЕ удаляем чтобы при повторном импорте CSV не идти
// в searchPublicChat для известно-мёртвых аккаунтов; lookup'ы отсеивают
// через WHERE is_deleted = false.
//
// Один блогер у пяти аккаунтов = одна строка. Tenancy isolation не нужна —
// данные публичные.
export const tgUsers = pgTable(
  "tg_users",
  {
    userId: text("user_id").primaryKey(),
    username: text("username"),
    fullName: text("full_name"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    isBot: boolean("is_bot").notNull().default(false),
    // Presence: peer сейчас в сети (userStatusOnline) или был последний раз
    // онлайн в lastSeenAt (userStatusOffline). recently/lastWeek/lastMonth
    // мапим в isOnline=false + lastSeenAt=null — UI рисует «был недавно».
    isOnline: boolean("is_online").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Под lookup «найти юзера по @username» (заменяет searchPublicChat).
    index("tg_users_username_lower_idx").on(sql`lower(${t.username})`),
  ],
);

// Magic-link для клиента-рекла: уникальная ссылка на шортлист кампании без
// регистрации. Доступ = знание токена (как Google Docs «по ссылке»). Без
// email — менеджер генерит ссылку и отправляет реклу как угодно. Токен
// валиден пока revoked_at IS NULL и (expires_at IS NULL OR expires_at > now()).
export const projectShares = pgTable(
  "project_shares",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // 32 байта URL-safe random (≈256 бит) — не угадывается.
    token: text("token").notNull().unique(),
    // Опциональная пометка «кому выдали» (вместо email): «Иван, бренд-менеджер».
    label: text("label"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Обновляется при каждом открытии клиентом — менеджер видит «открыто N назад».
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // Soft-delete: агентство отозвало доступ. Дальнейшие запросы → 401.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_shares_project_id_idx").on(t.projectId)],
);

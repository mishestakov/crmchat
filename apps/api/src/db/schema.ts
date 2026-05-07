import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
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

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(shortId),
  name: text("name").notNull(),
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

export const contactViewMode = pgEnum("contact_view_mode", ["list", "kanban"]);

export type ContactViewFilters = {
  q?: string;
  props?: Record<string, string>;
};

export const contactViews = pgTable(
  "contact_views",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mode: contactViewMode("mode").notNull().default("list"),
    filters: jsonb("filters")
      .$type<ContactViewFilters>()
      .notNull()
      .default({}),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_views_workspace_id_idx").on(t.workspaceId)],
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
  ],
);

// Личный CRM-аккаунт юзера: один на user (unique constraint), используется для
// импорта существующих чатов из TG-папок в CRM (см. /settings/telegram-sync).
// Outreach-аккаунты (для холодных рассылок) — отдельная сущность в
// `outreach_accounts`: multi per workspace, со своим proxy, warmup-pipeline,
// daily rate-limit. Не путать.
//
// MTProto-state живёт в `td-database/personal/<userId>/` (TDLib binlog +
// per-account peer cache). Эта таблица — справочник «у юзера подключен
// TG-аккаунт + базовый профиль для UI». Удаление row = drop personal client.
export const telegramAccounts = pgTable("telegram_accounts", {
  id: text("id").primaryKey().$defaultFn(shortId),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  tgUserId: text("tg_user_id").notNull(),
  tgUsername: text("tg_username"),
  phoneNumber: text("phone_number"),
  firstName: text("first_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Outreach-аккаунт: ОТПРАВЛЯЮЩИЙ TG-аккаунт для холодных рассылок. Не путать
// с `telegram_accounts` (личный CRM-аккаунт юзера, импорт чатов).
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
  "frozen",
  "unauthorized",
  "offline",
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
    // считает sent-за-сегодня и пропускает аккаунт когда упёрлись. Дефолт 30 —
    // безопасно для не-Premium аккаунта без warmup. Юзер может крутить.
    newLeadsDailyLimit: integer("new_leads_daily_limit").notNull().default(30),
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

// Outreach-список: источник лидов для будущей рассылки. Источники: csv (фаза 2),
// crm/crm-groups (потом). После импорта статус completed + importStats.
export const outreachListStatus = pgEnum("outreach_list_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);
export const outreachListSourceType = pgEnum("outreach_list_source_type", [
  "csv",
  // 'crm', 'crm_groups' — фаза 2.5/3
]);

export type OutreachListSourceMeta = {
  fileName?: string;
  usernameColumn?: string;
  phoneColumn?: string;
  columns?: string[];
  // Маппинг CRM-properties workspace → CSV-колонки (key = property.key,
  // value = column header). Смапленные значения попадают в lead.properties под
  // property.key; неcмапленные CSV-колонки — под raw header (для шаблонов).
  propertyMappings?: Record<string, string>;
};

export type OutreachListImportStats = {
  imported: number;
  skippedMissingIdentifier: number;
  skippedInvalidPhone: number;
  skippedDuplicate: number;
};

export const outreachLists = pgTable(
  "outreach_lists",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sourceType: outreachListSourceType("source_type").notNull(),
    sourceMeta: jsonb("source_meta")
      .$type<OutreachListSourceMeta>()
      .notNull()
      .default({}),
    status: outreachListStatus("status").notNull().default("pending"),
    totalSize: integer("total_size"),
    importStats: jsonb("import_stats").$type<OutreachListImportStats>(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outreach_lists_workspace_id_idx").on(t.workspaceId)],
);

// Outreach-лид: один peer в листе. tg_user_id заполнится при отправке (Phase 3 —
// resolve username через MTProto). До этого identifier = username || phone.
// `properties` — доп. колонки из CSV для подстановок типа {{firstName}}.
export const outreachLeads = pgTable(
  "outreach_leads",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => outreachLists.id, { onDelete: "cascade" }),
    username: text("username"),
    phone: text("phone"),
    tgUserId: text("tg_user_id"),
    // Когда лид впервые ответил нам (любой incoming от него после того как мы
    // ему написали). Заполняется outreach-listener'ом при NewMessage event.
    // Триггер для воркера: «не слать больше ничего этому лиду, в любой
    // sequence». Хранение момента (а не bool) — чтобы UI мог показать «ответил
    // 12 минут назад» и для будущих метрик «time-to-reply».
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    // Контакт, в который сконвертировался лид при первом ответе. Listener
    // создаёт contact (или находит дедуп по tg_user_id) и проставляет сюда.
    // ON DELETE SET NULL: удалили контакта руками — лид остаётся в outreach
    // для метрик, contactId просто очищается.
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    properties: jsonb("properties")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_leads_list_id_idx").on(t.listId),
    index("outreach_leads_workspace_id_idx").on(t.workspaceId),
    // Composite-индекс для inbound-listener: на каждое incoming TG-сообщение
    // делаем lookup `WHERE workspace_id = ? AND tg_user_id = ?`. Без индекса
    // — full scan по всем лидам workspace.
    index("outreach_leads_workspace_tg_user_id_idx").on(
      t.workspaceId,
      t.tgUserId,
    ),
    // Identity-уникальность лидов в одном листе: username (если есть) ИЛИ
    // phone — каждый сам по себе уникальный TG-идентификатор. Делаем ДВА
    // partial unique indexes, потому что один и тот же лид не должен иметь
    // ни двух записей по username, ни двух по phone.
    uniqueIndex("outreach_leads_list_username_unique")
      .on(t.listId, sql`lower(${t.username})`)
      .where(sql`${t.username} IS NOT NULL`),
    uniqueIndex("outreach_leads_list_phone_unique")
      .on(t.listId, t.phone)
      .where(sql`${t.phone} IS NOT NULL AND ${t.username} IS NULL`),
  ],
);

// Outreach-sequence: рассылка по одному списку лидов с N сообщениями и задержками.
// На активации (status: draft → active) воркер пресчитывает scheduled_messages
// для каждого лида × каждого сообщения. Изменения текста после активации НЕ
// влияют на уже распланированные — они snapshot-нуты в scheduled_messages.text.
//   - accountsMode 'all'      — использовать все active outreach-аккаунты workspace
//   - accountsMode 'selected' — только перечисленные в accountsSelected
// Аккаунт лиду назначается round-robin при активации и фиксируется в
// scheduled_messages.accountId — continuity-of-identity (один лид всегда от
// одного аккаунта).
export const outreachSequenceStatus = pgEnum("outreach_sequence_status", [
  "draft",
  "active",
  "paused",
  "completed",
]);
export const outreachAccountsMode = pgEnum("outreach_accounts_mode", [
  "all",
  "selected",
]);
export const contactCreationTrigger = pgEnum("contact_creation_trigger", [
  "on-reply",
  "on-first-message-sent",
]);

export type OutreachSequenceMessageDelay = {
  // 'minutes' нужен для тестов/демо; в проде разумно 'hours'/'days'.
  period: "minutes" | "hours" | "days";
  value: number;
};
export type OutreachSequenceMessage = {
  id: string;
  text: string;
  // Задержка ОТНОСИТЕЛЬНО предыдущего сообщения этой же sequence для этого лида.
  // Для первого сообщения (idx=0) применяется относительно момента активации.
  delay: OutreachSequenceMessageDelay;
};

export const outreachSequences = pgTable(
  "outreach_sequences",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    listId: text("list_id")
      .notNull()
      .references(() => outreachLists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: outreachSequenceStatus("status").notNull().default("draft"),
    accountsMode: outreachAccountsMode("accounts_mode").notNull().default("all"),
    accountsSelected: jsonb("accounts_selected")
      .$type<string[]>()
      .notNull()
      .default([]),
    messages: jsonb("messages")
      .$type<OutreachSequenceMessage[]>()
      .notNull()
      .default([]),
    // CRM-автоматизация: когда из лида создавать контакт + кому назначать
    // (round-robin по списку, пусто = createdBy sequence) + какие свойства
    // предзаполнить. Применяется в outreach-listener convertLeadToContact и
    // в worker'е (если trigger = on-first-message-sent — вызывается из
    // sendOne success-ветки, не дожидаясь ответа лида).
    contactCreationTrigger: contactCreationTrigger("contact_creation_trigger")
      .notNull()
      .default("on-reply"),
    contactDefaultOwnerIds: jsonb("contact_default_owner_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    contactDefaults: jsonb("contact_defaults")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Round-robin counter для contact_default_owner_ids — увеличиваем при
    // каждом успешном create-contact из этой sequence. Хранится в БД, чтобы
    // не сбрасываться на рестартах api.
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
    index("outreach_sequences_workspace_id_idx").on(t.workspaceId),
    index("outreach_sequences_list_id_idx").on(t.listId),
  ],
);

// Запланированное сообщение: одна строка = одна предстоящая отправка. Создаётся
// пачкой при активации sequence (lead × message_idx). text — snapshot ПОСЛЕ
// подстановки {{key}} переменных, чтобы редактирование sequence не порвало
// уже запланированное.
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
    sequenceId: text("sequence_id")
      .notNull()
      .references(() => outreachSequences.id, { onDelete: "cascade" }),
    leadId: text("lead_id")
      .notNull()
      .references(() => outreachLeads.id, { onDelete: "cascade" }),
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
    index("scheduled_messages_sequence_id_idx").on(t.sequenceId),
    index("scheduled_messages_lead_id_idx").on(t.leadId),
    // Composite-индекс под главный запрос воркера: pending по sendAt asc.
    index("scheduled_messages_worker_pick_idx").on(t.status, t.sendAt),
  ],
);

// Привязка «папка Telegram → workspace для импорта контактов». Один user может
// синкать несколько папок, каждую в свой workspace. Удаление = sync прекращается,
// уже импортированные контакты остаются.
export const telegramSyncConfigs = pgTable(
  "telegram_sync_configs",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").notNull(),
    folderTitle: text("folder_title").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    // Сколько новых контактов импортировано в последнюю синхронизацию (после
    // дедупа). Помогает юзеру понять «что-то приехало» vs «всё уже было».
    lastSyncImported: integer("last_sync_imported"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("tg_sync_user_folder_unique").on(t.userId, t.folderId),
    index("tg_sync_user_id_idx").on(t.userId),
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

// channels — площадки (TG-каналы/группы), которыми занимается бизнес.
// Связь с админом — через channel_admins (m:n: один канал может иметь
// несколько админов; один контакт может админить несколько каналов).
//
// tg_chat_id опциональный: для каналов из CSV-импорта мы знаем только
// ссылку, не resolved-id. Заполняется лениво если бот когда-нибудь увидит
// этот канал в replica (отложено в 11.3).
export const channels = pgTable(
  "channels",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tgChatId: text("tg_chat_id"),
    title: text("title").notNull(),
    link: text("link"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
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
  (t) => [
    index("channels_workspace_id_idx").on(t.workspaceId),
    // Дедуп при повторном CSV-импорте: одна и та же ссылка в воркспейсе =
    // один канал. lower() — потому что @Foo и @foo это один TG-канал.
    uniqueIndex("channels_workspace_link_unique")
      .on(t.workspaceId, sql`lower(${t.link})`)
      .where(sql`${t.link} IS NOT NULL`),
  ],
);

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
    title: text("title"),
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
    unreadCount: integer("unread_count").notNull().default(0),
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

// tg_users — глобальный словарь TG-собеседников. Реплицируем не-ботов
// (Regular + Deleted/Unknown). Боты — out of scope (защита от bot-trap'а
// делается отдельно по суффиксу @username).
//
// is_deleted=true для userTypeDeleted/Unknown — TG отозвал юзера или потерял
// к нему доступ. Строку НЕ удаляем чтобы при повторном импорте CSV не идти
// в searchPublicChat для известно-мёртвых аккаунтов; lookup'ы отсеивают
// через WHERE is_deleted = false.
//
// Один блогер у пяти аккаунтов = одна строка. Tenancy isolation не нужна —
// данные публичные. Phone заполняется только если TDLib его видит
// (контакт из address book аккаунта).
export const tgUsers = pgTable(
  "tg_users",
  {
    userId: text("user_id").primaryKey(),
    username: text("username"),
    fullName: text("full_name"),
    phone: text("phone"),
    isDeleted: boolean("is_deleted").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Под lookup «найти юзера по @username» (заменяет searchPublicChat).
    index("tg_users_username_lower_idx").on(sql`lower(${t.username})`),
  ],
);

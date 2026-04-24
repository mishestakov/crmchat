import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { shortId } from "./short-id";

// Все PK — короткие 12-hex id (см. short-id.ts). Раньше были UUID-36, в URL'ах
// и логах слишком длинно для нашей шкалы. Тип в БД — обычный text.

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(shortId),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey().$defaultFn(shortId),
  name: text("name").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => ({
    expiresAtIdx: index("sessions_expires_at_idx").on(t.expiresAt),
  }),
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey().$defaultFn(shortId),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index("workspaces_organization_id_idx").on(t.organizationId),
  }),
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
  (t) => ({
    workspaceKeyUnique: unique("properties_workspace_id_key_key").on(
      t.workspaceId,
      t.key,
    ),
    workspaceIdx: index("properties_workspace_id_idx").on(t.workspaceId),
  }),
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
  (t) => ({
    workspaceIdx: index("contact_views_workspace_id_idx").on(t.workspaceId),
  }),
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
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index("contacts_workspace_id_idx").on(t.workspaceId),
    // Functional-индекс под dedup при TG-импорте: lookup
    // `properties->>'tg_user_id'` иначе full scan по всей таблице.
    tgUserIdIdx: index("contacts_tg_user_id_idx").on(
      sql`(${t.properties} ->> 'tg_user_id')`,
    ),
  }),
);

// Личный CRM-аккаунт юзера: один на user (unique constraint), используется для
// импорта существующих чатов из TG-папок в CRM (см. /settings/telegram-sync).
// Outreach-аккаунты (для холодных рассылок) — это ОТДЕЛЬНАЯ сущность, придёт
// в своей таблице (`outreach_accounts` или подобное): multi per workspace, со
// своим proxy, warmup-pipeline, encrypted secrets, daily rate-limit. Не путать.
//
// session — long-lived MTProto session-string от gramjs (StringSession.save()),
// достаточно чтобы восстановить клиента без повторной аутентификации. Хранится
// plain в dev; в prod-сборке нужно зашифровать (TODO).
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
  session: text("session").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Outreach-аккаунт: ОТПРАВЛЯЮЩИЙ TG-аккаунт для холодных рассылок. Не путать
// с `telegram_accounts` (личный CRM-аккаунт юзера, импорт чатов).
//   - Multi per workspace (не unique по чему-либо identifying).
//   - Жизненный цикл: расходник; при бане — заводят новый.
//   - session AES-256-GCM шифруется (см. lib/crypto.ts).
//   - TODO фаза 4: proxy_id, warmup_*, bucket, transport, daily_limit, encrypted server/web sessions.
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
    session: text("session").notNull(),
    tgUserId: text("tg_user_id").notNull(),
    tgUsername: text("tg_username"),
    phoneNumber: text("phone_number"),
    firstName: text("first_name"),
    hasPremium: boolean("has_premium").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceIdx: index("outreach_accounts_workspace_id_idx").on(t.workspaceId),
    // Один и тот же TG-аккаунт нельзя добавить в один workspace дважды.
    workspaceTgUnique: unique("outreach_accounts_workspace_tg_unique").on(
      t.workspaceId,
      t.tgUserId,
    ),
  }),
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
  (t) => ({
    workspaceIdx: index("outreach_lists_workspace_id_idx").on(t.workspaceId),
  }),
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
    properties: jsonb("properties")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listIdx: index("outreach_leads_list_id_idx").on(t.listId),
    workspaceIdx: index("outreach_leads_workspace_id_idx").on(t.workspaceId),
  }),
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
  (t) => ({
    userFolderUnique: unique("tg_sync_user_folder_unique").on(
      t.userId,
      t.folderId,
    ),
    userIdx: index("tg_sync_user_id_idx").on(t.userId),
  }),
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
  (t) => ({
    contactIdx: index("activities_contact_id_idx").on(t.contactId),
  }),
);

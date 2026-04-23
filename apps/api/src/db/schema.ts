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

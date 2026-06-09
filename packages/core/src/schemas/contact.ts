import { z } from "zod";

// Ближайший открытый reminder контакта — рендерится в карточке kanban-а.
// Бэкенд считает через subquery; null если у контакта нет открытых напоминаний.
export const ContactNextStepSchema = z.object({
  date: z.iso.datetime(),
  text: z.string(),
  repeat: z.enum(["none", "daily", "weekly", "monthly"]),
});
export type ContactNextStep = z.infer<typeof ContactNextStepSchema>;

// Все данные контакта живут в `properties` (системные ключи + custom). Required-чек
// (full_name) делает бэкенд через enforceRequiredProperties, а не Zod — потому что
// "обязательность" зависит от runtime-определений в workspace.
export const ContactSchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  properties: z.record(z.string(), z.unknown()),
  nextStep: ContactNextStepSchema.nullable(),
  // Непрочитанные TG-входящие. Канбан рисует badge если > 0, обнуляется
  // на open-карточки или явный mark-read.
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime().nullable(),
  // Sticky outreach-аккаунт за этим контактом (см. schema.ts
  // contacts.primaryAccountId). Колонка таблицы «Контакты» рендерит имя
  // аккаунта по этому id, новый CSV-резолвер использует как первичный
  // источник sticky.
  primaryAccountId: z.string().min(1).max(64).nullable(),
  // Аккаунты воркспейса, у которых есть DM-история с этим контактом.
  // Источник — tg_chats. Сортировка: свежий last_inbound_at первым,
  // потом last_outbound_at; первый элемент — «дефолтный» аккаунт для
  // правой панели (10.7).
  chatAccounts: z.array(
    z.object({
      accountId: z.string(),
      lastInboundAt: z.iso.datetime().nullable(),
      lastOutboundAt: z.iso.datetime().nullable(),
    }),
  ),
  // Каналы, в которых этот контакт записан админом (m:n через
  // channel_admins). Минимум для table-row на карточке контакта; полный
  // Channel догружается отдельным GET /channels/{id}.
  channels: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      username: z.string().nullable(),
      memberCount: z.number().int().nullable(),
      lastMessageAt: z.iso.datetime().nullable(),
      hasDm: z.boolean(),
      unavailableSince: z.iso.datetime().nullable(),
    }),
  ),
  createdBy: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
});
export type Contact = z.infer<typeof ContactSchema>;

// Значения валидируются отдельно на сервере против CONTACT_FIELD_DEFS
// (см. apps/api/src/lib/entity-properties.ts) — здесь z.unknown(), потому что
// схема значения зависит от property.type.
// Поштучного создания контактов больше нет: 10.8 убрал кнопку «+ Новый» в
// /contacts и страницу /contacts/new. Контакты автосоздаются listener'ом на
// первом DM.
// Контакты появляются через: import собеседников аккаунта, CSV-импорт
// каналов (smart-stub), листенер на живом трафике, worker convertLeadToContact.
export const UpdateContactSchema = z.object({
  properties: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

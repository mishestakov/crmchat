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
  // на open-карточки или mark-read postMessage из TWA-iframe.
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime().nullable(),
  createdBy: z.string().min(1).max(64),
  createdAt: z.iso.datetime(),
});
export type Contact = z.infer<typeof ContactSchema>;

const ContactInputBase = z.object({
  // Значения валидируются отдельно на сервере против определений workspace'а
  // (см. apps/api/src/lib/contact-properties.ts) — здесь z.unknown(), потому что
  // схема значения зависит от runtime-определения property.type.
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const CreateContactSchema = ContactInputBase;
export type CreateContactInput = z.infer<typeof CreateContactSchema>;

export const UpdateContactSchema = ContactInputBase;
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

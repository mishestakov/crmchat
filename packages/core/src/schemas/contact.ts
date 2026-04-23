import { z } from "zod";

// Все данные контакта живут в `properties` (системные ключи + custom). Required-чек
// (full_name) делает бэкенд через enforceRequiredProperties, а не Zod — потому что
// "обязательность" зависит от runtime-определений в workspace.
export const ContactSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  properties: z.record(z.string(), z.unknown()),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
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

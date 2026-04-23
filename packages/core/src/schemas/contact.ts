import { z } from "zod";

export const ContactSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  telegramUsername: z.string().nullable(),
  properties: z.record(z.string(), z.unknown()),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type Contact = z.infer<typeof ContactSchema>;

// Empty string → null (фронт может слать "" из inputа, бэк хранит null).
const emptyToNull = (v: unknown) => (v === "" ? null : v);

const ContactInputBase = z.object({
  name: z.preprocess(
    emptyToNull,
    z.string().min(1).max(200).nullable().optional(),
  ),
  email: z.preprocess(
    emptyToNull,
    z.string().email().max(200).nullable().optional(),
  ),
  phone: z.preprocess(
    emptyToNull,
    z.string().max(64).nullable().optional(),
  ),
  telegramUsername: z.preprocess(
    emptyToNull,
    z.string().max(64).nullable().optional(),
  ),
  // properties валидируются отдельно на сервере против определений workspace'а
  // (см. apps/api/src/lib/contact-properties.ts) — здесь z.unknown(), потому что
  // схема значения зависит от runtime-определения property.type.
  properties: z.record(z.string(), z.unknown()).optional(),
});

// При создании требуем хотя бы одно identity-поле — чтобы не плодить «безликие» контакты.
export const CreateContactSchema = ContactInputBase.refine(
  (v) => Boolean(v.name || v.email || v.phone || v.telegramUsername),
  { message: "at least one of name/email/phone/telegramUsername required" },
);
export type CreateContactInput = z.infer<typeof CreateContactSchema>;

// Update — partial, без refine: можно поменять только properties.
export const UpdateContactSchema = ContactInputBase;
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

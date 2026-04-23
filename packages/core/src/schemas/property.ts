import { z } from "zod";

// Все типы донорского PROPERTY_METADATA. Createable (UI «новое поле») определяется
// клиентом — см. CREATEABLE_TYPES ниже. Бэкенд принимает любой тип в CreateProperty,
// но проставляет internal=false для пользовательских; preset (internal=true) сидятся
// при создании workspace и не создаются через API.
export const PropertyTypeSchema = z.enum([
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
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const CREATEABLE_PROPERTY_TYPES: PropertyType[] = [
  "text",
  "single_select",
  "multi_select",
];

// Зарезервированные ключи preset-properties (соответствуют donor's ALLOWED_PROPERTY_KEYS,
// без avatarUrl и без точечной нотации). Custom-keys должны не пересекаться.
export const RESERVED_PROPERTY_KEYS = new Set([
  "full_name",
  "description",
  "email",
  "phone",
  "telegram_username",
  "url",
  "amount",
  "stage",
]);

export const PropertyValueSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

export const PropertySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase, digits, underscore; starts with letter"),
  name: z.string().min(1).max(120),
  type: PropertyTypeSchema,
  order: z.number().int(),
  required: z.boolean(),
  showInList: z.boolean(),
  internal: z.boolean(),
  values: z.array(PropertyValueSchema).nullable(),
  createdAt: z.string().datetime(),
});
export type Property = z.infer<typeof PropertySchema>;

export const CreatePropertySchema = PropertySchema.pick({
  key: true,
  name: true,
  type: true,
})
  .extend({
    required: z.boolean().optional(),
    showInList: z.boolean().optional(),
    values: z.array(PropertyValueSchema).optional(),
  })
  // RESERVED_PROPERTY_KEYS = preset-поля (full_name, email, ...). Их сидит сервер
  // при создании workspace; пользователь не может создать кастом с тем же ключом
  // — иначе коллизия с system property и UI рендерил бы их как «обычные».
  .refine((v) => !RESERVED_PROPERTY_KEYS.has(v.key), {
    message: "key is reserved for a system property",
    path: ["key"],
  });
export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>;

export const UpdatePropertySchema = z
  .object({
    name: z.string().min(1).max(120),
    order: z.number().int(),
    required: z.boolean(),
    showInList: z.boolean(),
    values: z.array(PropertyValueSchema).nullable(),
  })
  .partial();
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;

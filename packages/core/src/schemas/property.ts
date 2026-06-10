import { z } from "zod";

// Все типы донорского PROPERTY_METADATA. Createable (UI «новое поле») определяется
// клиентом — см. CREATEABLE_TYPES ниже. Бэкенд принимает любой тип в CreateProperty.
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

// Каталог `properties` теперь про КАНАЛЫ. Зарезервированные ключи = собственные
// типизированные колонки channels.*: кастом-поле канала не должно их затенять
// (иначе «ниша» начала бы спорить с настоящим title/описанием/подписчиками).
export const RESERVED_PROPERTY_KEYS = new Set([
  "title",
  "username",
  "link",
  "description",
  "member_count",
  "external_id",
  "platform",
]);

export const PropertyValueSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type PropertyValue = z.infer<typeof PropertyValueSchema>;

export const PropertySchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "lowercase, digits, underscore; starts with letter"),
  name: z.string().min(1).max(120),
  type: PropertyTypeSchema,
  order: z.number().int(),
  required: z.boolean(),
  values: z.array(PropertyValueSchema).nullable(),
  createdAt: z.iso.datetime(),
});
export type Property = z.infer<typeof PropertySchema>;

export const CreatePropertySchema = PropertySchema.pick({
  key: true,
  name: true,
  type: true,
})
  .extend({
    required: z.boolean().optional(),
    values: z.array(PropertyValueSchema).optional(),
  })
  // Пользователь не может создать кастом-поле канала с ключом собственной
  // колонки channels.* — иначе коллизия с системным полем и UI рендерил бы их
  // как «обычные».
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
    values: z.array(PropertyValueSchema).nullable(),
  })
  .partial();
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;

// Минимальная форма определения поля — достаточно и для валидатора значений, и
// для рендера формы. Каналы берут это из таблицы `properties` (Property —
// супермножество FieldDef), контакты — из фиксированной константы ниже.
export type FieldDef = {
  key: string;
  name: string;
  type: PropertyType;
  required: boolean;
  values: PropertyValue[] | null;
};

// Системные поля контакта. В отличие от канала, у контакта НЕТ пользовательского
// каталога (контакт-привязка кастом-полей была донор-наследием lead-CRM): это
// фиксированный набор, общий для API-валидации и формы контакта. `tg_user_id` —
// служебное, заполняется системно (TG-импорт, outreach, listener).
export const CONTACT_FIELD_DEFS: FieldDef[] = [
  { key: "full_name", name: "Имя", type: "text", required: true, values: null },
  // «Описание/памятка» выпилено из пресетов (10.06.26): памятка живёт в
  // contacts.note (автор+дата), два поля с одним смыслом путали менеджеров.
  {
    key: "telegram_username",
    name: "Telegram",
    type: "text",
    required: false,
    values: null,
  },
  { key: "tg_user_id", name: "TG ID", type: "text", required: false, values: null },
];

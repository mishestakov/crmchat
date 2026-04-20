import * as z from "zod";

const ALLOWED_PROPERTY_KEYS = new Set([
  "fullName",
  "description",
  "url",
  "email",
  "phone",
  "telegram.username",
  "amount",
  "ownerId",
]);

export function isAllowedPropertyKey(key: string) {
  return key.startsWith("custom.") || ALLOWED_PROPERTY_KEYS.has(key);
}

export const colorSchema = z.enum([
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
]);
export type Color = z.infer<typeof colorSchema>;

export const selectOptionSchema = z
  .object({
    label: z.string().meta({ apiAccess: "writable" }),
    value: z.string().meta({ apiAccess: "write-once" }),
    color: colorSchema.optional().meta({ apiAccess: "writable" }),
    daysUntilStale: z.number().optional().meta({ apiAccess: "writable" }),
  })
  .meta({ title: "SelectOption" });
export type SelectOption = z.infer<typeof selectOptionSchema>;

const basePropertySchema = z.object({
  key: z.string().meta({ apiAccess: "write-once" }),
  type: z.string().meta({ apiAccess: "write-once" }),
  name: z.string().trim().min(1, "Required").meta({ apiAccess: "writable" }),
  description: z.string().trim().optional().meta({ apiAccess: "writable" }),
  placeholder: z.string().optional().meta({ apiAccess: "writable" }),
  required: z.boolean().default(false).meta({ apiAccess: "writable" }),
  readonly: z.boolean().optional().meta({ apiAccess: "readonly" }),
  internal: z.boolean().optional(),
});

export const textPropertySchema = basePropertySchema
  .extend({
    type: z.literal("text").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "TextProperty" });
export type TextProperty = z.infer<typeof textPropertySchema>;

export const selectPropertySchema = basePropertySchema
  .extend({
    type: z.literal("single-select").meta({ apiAccess: "write-once" }),
    options: z
      .array(selectOptionSchema)
      .min(1, "Required")
      .meta({ apiAccess: "writable" }),
    customizable: z.boolean().default(true).meta({ apiAccess: "writable" }),
    displayedInList: z.boolean().optional().meta({ apiAccess: "writable" }),
    defaultValue: z.string().optional().meta({ apiAccess: "writable" }),
  })
  .meta({ title: "SingleSelectProperty" });
export type SingleSelectProperty = z.infer<typeof selectPropertySchema>;

export const multiSelectPropertySchema = basePropertySchema
  .extend({
    type: z.literal("multi-select").meta({ apiAccess: "write-once" }),
    options: z
      .array(selectOptionSchema)
      .min(1, "Required")
      .meta({ apiAccess: "writable" }),
    customizable: z.boolean().default(true).meta({ apiAccess: "writable" }),
    displayedInList: z.boolean().optional().meta({ apiAccess: "writable" }),
  })
  .meta({ title: "MultiSelectProperty" });
export type MultiSelectProperty = z.infer<typeof multiSelectPropertySchema>;

export const userSelectPropertySchema = basePropertySchema
  .extend({
    type: z.literal("user-select").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "UserSelectProperty" });
export type UserSelectProperty = z.infer<typeof userSelectPropertySchema>;

export const textAreaPropertySchema = basePropertySchema
  .extend({
    type: z.literal("textarea").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "TextareaProperty" });
export type TextAreaProperty = z.infer<typeof textAreaPropertySchema>;

export const urlPropertySchema = basePropertySchema
  .extend({
    type: z.literal("url").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "UrlProperty" });
export type UrlProperty = z.infer<typeof urlPropertySchema>;

export const emailPropertySchema = basePropertySchema
  .extend({
    type: z.literal("email").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "EmailProperty" });
export type EmailProperty = z.infer<typeof emailPropertySchema>;

export const amountPropertySchema = basePropertySchema
  .extend({
    type: z.literal("amount").meta({ apiAccess: "write-once" }),
    displayedInList: z.boolean().optional().meta({ apiAccess: "writable" }),
  })
  .meta({ title: "AmountProperty" });
export type AmountProperty = z.infer<typeof amountPropertySchema>;

export const telPropertySchema = basePropertySchema
  .extend({
    type: z.literal("tel").meta({ apiAccess: "write-once" }),
  })
  .meta({ title: "TelProperty" });
export type TelProperty = z.infer<typeof telPropertySchema>;

export const propertySchema = z.discriminatedUnion("type", [
  textPropertySchema,
  selectPropertySchema,
  multiSelectPropertySchema,
  userSelectPropertySchema,
  textAreaPropertySchema,
  urlPropertySchema,
  emailPropertySchema,
  amountPropertySchema,
  telPropertySchema,
]);
export type Property = z.infer<typeof propertySchema>;

export const propertySchemaMap = {
  text: textPropertySchema,
  "single-select": selectPropertySchema,
  "multi-select": multiSelectPropertySchema,
  "user-select": userSelectPropertySchema,
  textarea: textAreaPropertySchema,
  url: urlPropertySchema,
  email: emailPropertySchema,
  amount: amountPropertySchema,
  tel: telPropertySchema,
} as const;

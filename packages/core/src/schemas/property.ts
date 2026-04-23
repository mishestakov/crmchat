import { z } from "zod";

export const PropertyTypeSchema = z.enum([
  "text",
  "single_select",
  "multi_select",
]);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

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
  values: z.array(PropertyValueSchema).nullable(),
  createdAt: z.string().datetime(),
});
export type Property = z.infer<typeof PropertySchema>;

export const CreatePropertySchema = PropertySchema.pick({
  key: true,
  name: true,
  type: true,
}).extend({
  required: z.boolean().optional(),
  showInList: z.boolean().optional(),
  values: z.array(PropertyValueSchema).optional(),
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

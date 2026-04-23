import { z } from "zod";

export const PropertyTypeSchema = z.enum(["text", "number", "single_select"]);
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
  values: z.array(PropertyValueSchema).nullable(),
  createdAt: z.string().datetime(),
});
export type Property = z.infer<typeof PropertySchema>;

export const CreatePropertySchema = PropertySchema.pick({
  key: true,
  name: true,
  type: true,
}).extend({
  values: z.array(PropertyValueSchema).optional(),
});
export type CreatePropertyInput = z.infer<typeof CreatePropertySchema>;

export const UpdatePropertySchema = z
  .object({
    name: z.string().min(1).max(120),
    order: z.number().int(),
    values: z.array(PropertyValueSchema).nullable(),
  })
  .partial();
export type UpdatePropertyInput = z.infer<typeof UpdatePropertySchema>;

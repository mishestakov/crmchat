import { z } from "zod";

export const ContactViewModeSchema = z.enum(["list", "kanban"]);
export type ContactViewMode = z.infer<typeof ContactViewModeSchema>;

export const ContactViewFiltersSchema = z.object({
  q: z.string().optional(),
  // { propertyKey: value } — для single_select это option.id; для text/number — как строка.
  props: z.record(z.string(), z.string()).optional(),
});
export type ContactViewFilters = z.infer<typeof ContactViewFiltersSchema>;

export const ContactViewSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  mode: ContactViewModeSchema,
  filters: ContactViewFiltersSchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ContactView = z.infer<typeof ContactViewSchema>;

export const CreateContactViewSchema = z.object({
  name: z.string().min(1).max(120),
  mode: ContactViewModeSchema,
  filters: ContactViewFiltersSchema,
});
export type CreateContactViewInput = z.infer<typeof CreateContactViewSchema>;

export const UpdateContactViewSchema = z
  .object({
    name: z.string().min(1).max(120),
    mode: ContactViewModeSchema,
    filters: ContactViewFiltersSchema,
  })
  .partial();
export type UpdateContactViewInput = z.infer<typeof UpdateContactViewSchema>;

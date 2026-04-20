import * as z from "zod";

export const ViewOptionsSchema = z.object({
  type: z.literal(["list", "pipeline"]),
  q: z.string().optional(),
  filters: z.record(z.string(), z.array(z.string())),
  sort: z.enum(["default", "dueDate", "fullName", "createdAt"]),
  pipelineProperty: z.string().nullish(),
  hideEmptyColumns: z.boolean().optional(),
});

export const ViewSchema = ViewOptionsSchema.extend({
  id: z.string(),
  name: z.string(),
});

export type ViewOptions = z.infer<typeof ViewOptionsSchema>;
export type View = z.infer<typeof ViewSchema>;

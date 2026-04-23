import { z } from "zod";

export const ActivityTypeSchema = z.enum(["note", "reminder"]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const ActivityStatusSchema = z.enum(["open", "completed"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ActivityRepeatSchema = z.enum([
  "none",
  "daily",
  "weekly",
  "monthly",
]);
export type ActivityRepeat = z.infer<typeof ActivityRepeatSchema>;

export const ActivitySchema = z.object({
  id: z.string().min(1).max(64),
  workspaceId: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
  type: ActivityTypeSchema,
  text: z.string(),
  date: z.string().datetime().nullable(),
  repeat: ActivityRepeatSchema,
  status: ActivityStatusSchema,
  completedAt: z.string().datetime().nullable(),
  createdBy: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Activity = z.infer<typeof ActivitySchema>;

// Discriminated union — note без date/repeat, reminder с обязательной date.
export const CreateActivitySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("note"),
    text: z.string().min(1).max(5000),
  }),
  z.object({
    type: z.literal("reminder"),
    text: z.string().min(1).max(5000),
    date: z.string().datetime(),
    repeat: ActivityRepeatSchema.optional(),
  }),
]);
export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;

// type не редактируем — это бы изменило смысл записи.
// date/repeat — только reminder; handler 400-нет, если пришло для note.
export const UpdateActivitySchema = z
  .object({
    text: z.string().min(1).max(5000),
    date: z.string().datetime().nullable(),
    repeat: ActivityRepeatSchema,
    status: ActivityStatusSchema,
  })
  .partial();
export type UpdateActivityInput = z.infer<typeof UpdateActivitySchema>;

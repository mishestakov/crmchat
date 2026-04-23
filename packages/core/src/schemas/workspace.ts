import { z } from "zod";

export const WorkspaceSchema = z.object({
  id: z.string().min(1).max(64),
  organizationId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  createdBy: z.string().min(1).max(64),
  createdAt: z.string().datetime(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = WorkspaceSchema.pick({ name: true });
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = WorkspaceSchema.pick({ name: true }).partial();
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

import * as z from "zod";

import { Timestamp, WithId, timestampField } from "./common";
import { SendingScheduleSchema } from "./outreach";
import { propertySchema } from "./properties";
import { ViewSchema } from "./views";
import { WebhookSubscription } from "./webhook";

export const WorkspaceObjectTypeSchema = z.enum(["contacts"]);
export type WorkspaceObjectType = z.infer<typeof WorkspaceObjectTypeSchema>;

export const appFeatures = ["devtools", "new-unread"] as const;
export type AppFeature = (typeof appFeatures)[number] | (string & {});
export const AppFeatureSchema = z.custom<AppFeature>(
  (val) => typeof val === "string"
);

export const WorkspaceSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  createdBy: z.string(),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),
  organizationId: z.string().meta({ apiAccess: "readonly" }),

  name: z.string().meta({ apiAccess: "writable" }),

  properties: z
    .record(WorkspaceObjectTypeSchema, z.array(propertySchema))
    .optional(),
  views: z.record(WorkspaceObjectTypeSchema, z.array(ViewSchema)).optional(),

  features: z.array(AppFeatureSchema).optional(),
  outreachSendingSchedule: SendingScheduleSchema.optional(),

  /** Members IDS. Used for efficient query */
  members: z.array(z.string()).optional().meta({ apiAccess: "readonly" }),
  membersCount: z.number().optional(),

  /** When true, accounts in this workspace are excluded from billing count */
  excludeFromAccountBilling: z.boolean().optional(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceWithId = WithId<Workspace>;

export const zapierSubscriptionSchema = z
  .object({
    type: z.enum(["ContactCreated", "NewContact"]),
    hookUrl: z.string(),
  })
  .or(
    z.object({
      type: z.literal("ContactUpdated"),
      hookUrl: z.string(),
    })
  );

export type ZapierSubscription = z.infer<typeof zapierSubscriptionSchema>;

export interface WorkspacePrivateData {
  zapierApiKey?: string;
  zapierSubscriptions?: Record<string, ZapierSubscription>;
  webhookSubscriptions?: Record<string, WebhookSubscription>;
}

export const WorkspaceRoleSchema = z.enum(["admin", "member", "chatter"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export interface WorkspaceMember {
  createdAt: Timestamp;
  updatedAt: Timestamp;

  userId: string;
  role: WorkspaceRole;
}
export type WorkspaceMemberWithId = WithId<WorkspaceMember>;

export const PublicWorkspaceMemberSchema = z.object({
  userId: z.string(),
  role: WorkspaceRoleSchema,
  user: z.object({
    name: z.string(),
    avatarUrl: z.string().optional(),
    timezone: z.string().optional(),
    telegramUsername: z.string().optional(),
  }),
});
export type PublicWorkspaceMember = z.infer<typeof PublicWorkspaceMemberSchema>;

export interface WorkspaceInvite {
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;

  inviteCode: string;
  telegramUsername: string;
  role: WorkspaceRole;

  expiresAt: Timestamp;
  acceptedAt?: Timestamp;
}
export type WorkspaceInviteWithId = WithId<WorkspaceInvite>;

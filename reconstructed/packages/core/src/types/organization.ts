import * as z from "zod";

import { WithId, timestampField } from "./common";
import { SubscriptionSchema } from "./subscription";
import { WalletSchema } from "./wallet";

export const OrganizationSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  createdBy: z.string(),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),

  name: z.string().optional().meta({ apiAccess: "writable" }),
  subscription: SubscriptionSchema.optional(),

  membersCount: z.number(),
  activeTelegramAccountsCount: z.number().optional(),

  /** Limit the number of workspaces a user can create */
  workspacesLimit: z.number().optional(),

  /** Limit the number of active telegram accounts an organization can have */
  telegramAccountsLimit: z.number().optional(),

  wallet: WalletSchema.optional(),
  welcomeBonusReceivedAt: z
    .object({
      team: timestampField().optional(),
      outreach: timestampField().optional(),
    })
    .optional(),
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type OrganizationWithId = WithId<Organization>;

import * as z from "zod";

import { CustomPropertyValueSchema, WithId, timestampField } from "./common";

export type { Timestamp } from "./common";

export type ContactSource =
  | "forwarded_message"
  | "image"
  | "telegram_username"
  | "text"
  | "voice"
  | "telegram-sync"
  | "qr-code";

export const CustomPropertyMetadataSchema = z.object({
  updatedAt: timestampField(),
  lastStaleNotification: timestampField().optional(),
});
export type CustomPropertyMetadata = z.infer<
  typeof CustomPropertyMetadataSchema
>;

export const ContactAccountStatusSchema = z.object({
  unread: z.boolean(),
  unreadCount: z.number(),
});
export type ContactAccountStatus = z.infer<typeof ContactAccountStatusSchema>;

export const ContactSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  createdBy: z.string().min(1),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),

  workspaceId: z.string().min(1).meta({ apiAccess: "readonly" }),
  ownerId: z.string().min(1).meta({ apiAccess: "writable" }),

  /** @default "contact" */
  type: z.enum(["contact", "group"]).optional().meta({ apiAccess: "writable" }),

  fullName: z.string().min(1).meta({ apiAccess: "writable" }),
  description: z.string().optional().meta({ apiAccess: "writable" }),
  avatarUrl: z.string().optional().meta({ apiAccess: "writable" }),
  email: z.email().optional().meta({ apiAccess: "writable" }),
  phone: z.string().optional().meta({ apiAccess: "writable" }),
  url: z.url().optional().meta({ apiAccess: "writable" }),
  amount: z.number().optional().meta({ apiAccess: "writable" }),

  telegram: z
    .object({
      id: z.number().optional().meta({ apiAccess: "writable" }),
      username: z.string().optional().meta({ apiAccess: "writable" }),
      usernameNormalized: z.string().optional(),
      name: z.string().optional(),

      syncedAt: timestampField().optional(),
      folders: z.array(z.string()).optional().meta({ apiAccess: "readonly" }),
      inviteLink: z.url().optional().meta({ apiAccess: "writable" }),

      /** @deprecated fetch dialogs instead */
      account: z.record(z.string(), ContactAccountStatusSchema).optional(),
      lastUnreadMessage: timestampField().optional(),
    })
    .optional(),

  custom: z
    .record(z.string(), CustomPropertyValueSchema)
    .optional()
    .meta({ apiAccess: "writable" }),

  customMetadata: z.record(z.string(), CustomPropertyMetadataSchema).optional(),
  importedAt: timestampField().optional(),
  isOnboardingContact: z.boolean().optional(),
});

export type Contact = z.infer<typeof ContactSchema>;
export type ContactWithId = WithId<Contact>;

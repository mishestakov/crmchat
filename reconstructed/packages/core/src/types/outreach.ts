import { Simplify } from "radashi";
import * as z from "zod";

import {
  CustomPropertyValueSchema,
  Timestamp,
  WithId,
  timestampField,
} from "./common";

export const ContactOwnerSettingsSchema = z.object({
  ownerIds: z.array(z.string()).meta({
    apiAccess: "writable",
    description:
      "User IDs to assign as owners of contacts created from this campaign. Multiple IDs enable round-robin assignment.",
  }),
  lastAssignedIndex: z.number().optional(),
});

export type ContactOwnerSettings = z.infer<typeof ContactOwnerSettingsSchema>;

export const OutreachListSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  createdBy: z.string().meta({ apiAccess: "readonly" }),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),

  workspaceId: z.string().meta({ apiAccess: "readonly" }),
  name: z.string().meta({ apiAccess: "writable" }),

  source: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("csvFile"),
      fileUrl: z.string().meta({ apiAccess: "readonly" }),
      fileName: z.string().meta({ apiAccess: "readonly" }),
      usernameColumn: z.string().optional().meta({ apiAccess: "readonly" }),
      phoneColumn: z.string().optional().meta({ apiAccess: "readonly" }),
      columns: z.array(z.string()).meta({ apiAccess: "readonly" }),
    }),
    z.object({
      type: z.literal("crm"),
      dynamic: z.boolean().meta({ apiAccess: "readonly" }),
      filters: z
        .record(z.string(), z.array(z.string()))
        .meta({ apiAccess: "readonly" }),
    }),
    z.object({
      type: z.literal("crmGroups"),
      dynamic: z.boolean().meta({ apiAccess: "readonly" }),
      filters: z
        .record(z.string(), z.array(z.string()))
        .meta({ apiAccess: "readonly" }),
    }),
  ]),

  status: z
    .enum(["pending", "processing", "completed", "failed"])
    .meta({ apiAccess: "readonly" }),
  totalSize: z.number().optional().meta({ apiAccess: "readonly" }),
  importStats: z
    .object({
      imported: z.number().meta({ apiAccess: "readonly" }),
      skippedMissingIdentifier: z.number().meta({ apiAccess: "readonly" }),
      skippedInvalidPhone: z.number().meta({ apiAccess: "readonly" }),
      skippedDuplicate: z.number().meta({ apiAccess: "readonly" }),
    })
    .optional(),
});

export type OutreachList = z.infer<typeof OutreachListSchema>;
export type OutreachListWithId = WithId<OutreachList>;
export type OutreachListWithSource<T extends OutreachList["source"]["type"]> =
  OutreachListWithId & { source: { type: T } };

export type LeadSequenceStatus = {
  accountId?: string;
  messages?: {
    [sequenceMessageId: string]: {
      sentAt: Timestamp;
      readAt?: Timestamp;
      repliedAt?: Timestamp;
    };
  };
  stopReason?:
    | "invalidUsername"
    | "phoneUnreachable"
    | "usernameAndPhoneUnreachable"
    | "replied"
    /** @deprecated */
    | "removed-by-user"
    | "duplicate"
    | "chat-deleted"
    | "user-deactivated"
    | "payment-required";
  duplicate?: {
    /** IDs of lists that already have the lead */
    lists?: string[];
    /** IDs of existing contacts in CRM */
    contacts?: string[];
    /** IDs of accounts that already have the conversation with the lead */
    accounts?: string[];
  };
};

export type OutreachLeadPeer =
  | {
      type?: "user";
      peerId?: number;
      username?: string;
      usernameNormalized?: string;
      phone?: string;
    }
  | {
      type: "group";
      peerId: number;
    };
export type OutreachLead = {
  createdAt: Timestamp;
  updatedAt: Timestamp;

  workspaceId: string;
  listIds: string[];

  properties?: {
    [listId: string]: Record<string, string>;
  };
  contactId?: string;

  sequenceStatus?: {
    [sequenceId: string]: LeadSequenceStatus;
  };
} & OutreachLeadPeer;
export type OutreachLeadWithId = WithId<OutreachLead>;
export type OutreachUserLeadWithId = Simplify<
  OutreachLeadWithId & { type?: "user" }
>;
export type OutreachGroupLeadWithId = Simplify<
  OutreachLeadWithId & { type: "group" }
>;

export const OutreachTextMessageSchema = z.object({
  type: z.literal("text").optional(),
  text: z.string().trim().min(1).meta({ apiAccess: "writable" }),
});

export const OutreachMediaMessageSchema = z.object({
  type: z.literal("media"),
  media: z
    .array(
      z.object({
        url: z.url().meta({ apiAccess: "writable" }),
        mimeType: z.string().min(1).meta({ apiAccess: "writable" }),
        fileSize: z.number().meta({ apiAccess: "writable" }),
        width: z.number().meta({ apiAccess: "writable" }),
        height: z.number().meta({ apiAccess: "writable" }),
        duration: z.number().optional().meta({ apiAccess: "writable" }),
      })
    )
    .min(1)
    .max(10)
    .meta({ apiAccess: "writable" }),
  caption: z.string().trim().optional().meta({ apiAccess: "writable" }),
});

export const OutreachDocumentMessageSchema = z.object({
  type: z.literal("document"),
  documents: z
    .array(
      z.object({
        url: z.url().meta({ apiAccess: "writable" }),
        mimeType: z.string().min(1).meta({ apiAccess: "writable" }),
        fileName: z.string().meta({ apiAccess: "writable" }),
        fileSize: z.number().meta({ apiAccess: "writable" }),
      })
    )
    .min(1)
    .max(10)
    .meta({ apiAccess: "writable" }),
  caption: z.string().trim().optional().meta({ apiAccess: "writable" }),
});

export const OutreachVoiceMessageSchema = z.object({
  type: z.literal("voice"),
  voice: z
    .object({
      url: z.url().meta({ apiAccess: "writable" }),
      mimeType: z.string().min(1).meta({ apiAccess: "writable" }),
      fileSize: z.number().meta({ apiAccess: "writable" }),
      duration: z.number().meta({ apiAccess: "writable" }),
    })
    .default({
      url: "",
      mimeType: "",
      fileSize: 0,
      duration: 0,
    }),
});

export const OutreachMessageContentSchema = z.discriminatedUnion("type", [
  OutreachTextMessageSchema,
  OutreachMediaMessageSchema,
  OutreachDocumentMessageSchema,
  OutreachVoiceMessageSchema,
]);

export type OutreachMessageContent = z.infer<
  typeof OutreachMessageContentSchema
>;

const sequenceMessageBase = z.object({
  id: z.string().meta({ apiAccess: "writable" }),
  delay: z.object({
    period: z
      .enum(["minutes", "hours", "days"])
      .meta({ apiAccess: "writable" }),
    value: z.number().meta({ apiAccess: "writable" }),
  }),
});

export const OutreachSequenceMessageSchema = z.discriminatedUnion("type", [
  sequenceMessageBase
    .extend(OutreachTextMessageSchema.shape)
    .meta({ title: "TextMessage" }),
  sequenceMessageBase
    .extend(OutreachMediaMessageSchema.shape)
    .meta({ title: "MediaMessage" }),
  sequenceMessageBase
    .extend(OutreachDocumentMessageSchema.shape)
    .meta({ title: "DocumentMessage" }),
  sequenceMessageBase
    .extend(OutreachVoiceMessageSchema.shape)
    .meta({ title: "VoiceMessage" }),
]);

export type OutreachSequenceMessage = z.infer<
  typeof OutreachSequenceMessageSchema
>;

const DayOfWeekSchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

const SendingHoursSchema = z
  .object({
    startHour: z.number(),
    endHour: z.number(),
  })
  .refine((data) => data.startHour < data.endHour, {
    message: "Start hour must be before end hour",
  });

export type SendingHours = z.infer<typeof SendingHoursSchema>;

export const SendingScheduleSchema = z.object({
  timezone: z.string(),
  dailySchedule: z.record(
    DayOfWeekSchema,
    z.union([SendingHoursSchema, z.literal(false)])
  ),
});

export type SendingSchedule = z.infer<typeof SendingScheduleSchema>;

export const defaultSendingHours: SendingHours = { startHour: 9, endHour: 18 };
export const defaultSendingSchedule: SendingSchedule = {
  timezone: "UTC",
  dailySchedule: {
    monday: defaultSendingHours,
    tuesday: defaultSendingHours,
    wednesday: defaultSendingHours,
    thursday: defaultSendingHours,
    friday: defaultSendingHours,
    saturday: false,
    sunday: false,
  },
};

export const OutreachSequenceSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  createdBy: z.string().meta({ apiAccess: "readonly" }),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),
  completedAt: timestampField().optional(),

  workspaceId: z.string().meta({ apiAccess: "readonly" }),
  listId: z.string().meta({ apiAccess: "write-once" }),

  name: z.string().meta({ apiAccess: "writable" }),
  status: z
    .enum(["draft", "active", "paused", "completed"])
    .meta({ apiAccess: "readonly" }),

  accounts: z
    .object({
      mode: z.enum(["all", "selected"]).meta({ apiAccess: "writable" }),
      selected: z.array(z.string()).optional().meta({
        apiAccess: "writable",
        description:
          "Telegram account IDs to send from. Only used when mode is `selected`.",
      }),
    })
    .optional(),

  contactOwnerSettings: ContactOwnerSettingsSchema.optional(),
  contactCreationTrigger: z
    .enum(["on-reply", "on-first-message-sent"])
    .optional()
    .meta({ apiAccess: "writable" }),
  contactDefaults: z
    .record(z.string(), CustomPropertyValueSchema)
    .optional()
    .meta({ apiAccess: "writable" }),

  messages: z
    .array(OutreachSequenceMessageSchema)
    .meta({ apiAccess: "writable" }),
  duplicationResolutionNeeded: z
    .boolean()
    .optional()
    .meta({ apiAccess: "readonly" }),

  totalLeads: z.number().optional().meta({ apiAccess: "readonly" }),
  completedLeadsCount: z.number().optional().meta({ apiAccess: "readonly" }),
});

export type OutreachSequence = z.infer<typeof OutreachSequenceSchema>;
export type OutreachSequenceWithId = WithId<OutreachSequence>;

export interface ScheduledMessage {
  workspaceId: string;
  leadId: string;
  accountId: string;
  sequenceId: string;
  sequenceMessageId: string;
  sendAt: Timestamp;
  status: "pending" | "sending" | "sent" | "failed";
  error?: string;
  internalError?: string;
  errorId?: string;
  retryAttemptsLeft?: number;
}
export type ScheduledMessageWithId = WithId<ScheduledMessage>;

// Analytics types
export type SequenceAnalyticsViewMode = "sendDate" | "eventDate";
export type SequenceAnalyticsGrouping = "day" | "week" | "month";

export interface SequenceAnalyticsDataPoint {
  date: string; // ISO date string for bucket start (YYYY-MM-DD)
  sent: number;
  read: number;
  replied: number;
}

export interface SequenceAnalyticsResult {
  dataPoints: SequenceAnalyticsDataPoint[];
  grouping: SequenceAnalyticsGrouping;
}

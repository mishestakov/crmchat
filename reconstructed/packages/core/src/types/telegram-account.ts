import * as z from "zod";

import { Timestamp, WithId, timestampField } from "./common";

export const TelegramPlatformSchema = z.enum([
  "iOS",
  "macOS",
  "Windows",
  "Android",
  "Linux",
  "Unknown platform",
]);

export type TelegramPlatform = z.infer<typeof TelegramPlatformSchema>;

export const DeviceOptionsSchema = z.object({
  platform: TelegramPlatformSchema,
  userAgent: z.string(),
  langCode: z.string(),
  systemLangCode: z.string(),
});

export type DeviceOptions = z.infer<typeof DeviceOptionsSchema>;

export const ContactCreationBehaviourSchema = z.enum([
  "disabled",
  "message-received",
]);

export type ContactCreationBehaviour = z.infer<
  typeof ContactCreationBehaviourSchema
>;

export interface TelegramAccount {
  createdAt: Timestamp;
  createdBy: string;
  updatedAt: Timestamp;

  workspaceId: string;

  proxyId: string;
  oldProxyIds?: string[];
  tokenEncrypted: string;
  status: "active" | "banned" | "frozen" | "unauthorized" | "offline";

  /**
   * Partitioning bucket for dc-proxy horizontal scaling. Pod ordinal that
   * owns this account; `bucket === podIndex` directly (range
   * `[0, POD_COUNT)`). Changing `POD_COUNT` requires a full reassignment
   * migration. See {@link assignBucket}.
   */
  bucket: number;

  dialogSync?: {
    lastSyncAt: Timestamp;
    lastFullSyncAt: Timestamp;
  };

  serverSessionEncrypted: string;
  webSessionEncrypted?: string;

  telegram: {
    id: number;
    username?: string | null;
    phone: string | null;
    fullName?: string | null;
    hasPremium: boolean;
  };

  contactCreationBehaviour?: ContactCreationBehaviour;

  device: DeviceOptions;
  transport?: "tcp" | "ws";

  newLeadsDailyLimit: number;

  warmup?: {
    enabled: boolean;
    stage: WarmupStage;
    peers?: number[];
    startedAt: Timestamp;
  };
  warmupHelper?: boolean;
}
export type TelegramAccountWithId = WithId<TelegramAccount>;

export const TelegramAccountApiSchema = z.object({
  createdAt: timestampField().meta({ apiAccess: "readonly" }),
  updatedAt: timestampField().meta({ apiAccess: "readonly" }),

  status: z
    .enum(["active", "banned", "frozen", "unauthorized", "offline"])
    .meta({ apiAccess: "readonly" }),

  telegram: z.object({
    id: z.number().meta({ apiAccess: "readonly" }),
    username: z.string().nullable().optional().meta({ apiAccess: "readonly" }),
    phone: z.string().nullable().meta({ apiAccess: "readonly" }),
    fullName: z.string().nullable().optional().meta({ apiAccess: "readonly" }),
    hasPremium: z.boolean().meta({ apiAccess: "readonly" }),
  }),

  contactCreationBehaviour: ContactCreationBehaviourSchema.optional().meta({
    apiAccess: "writable",
  }),

  newLeadsDailyLimit: z
    .number()
    .int()
    .min(0)
    .max(500)
    .meta({ apiAccess: "writable" }),

  warmup: z
    .object({
      enabled: z.boolean().meta({ apiAccess: "readonly" }),
      stage: z
        .enum(["initial", "engagement", "maintenance"])
        .meta({ apiAccess: "readonly" }),
    })
    .optional(),
});

export type TelegramAccountAuthState = {
  error?:
    | {
        code:
          | "proxyCountryUnavailable"
          | "phoneNumberInvalid"
          | "phoneNumberBanned"
          | "emailRequired"
          | "codeInvalid"
          | "passwordInvalid"
          | "passwordFlood"
          | "unknownError";
        params?: undefined;
      }
    | {
        code: "floodWait";
        params: { waitSeconds: number };
      };
} & (
  | {
      type: "idle";
      status: "idle" | "proxyPending" | "proxyReady";
    }
  | {
      type: "codeSent";
      codeHash: string;
      codeLength: number;
      method: string;
      nextType?: string;
      timeout?: number;
    }
  | {
      type: "passwordNeeded";
      hint?: string;
    }
  | {
      type: "success";
      accountId: string;
    }
);

export type ReauthStateData =
  | { type: "idle"; error?: string }
  | { type: "passwordNeeded"; error?: string }
  | { type: "success" }
  | { type: "unknownError"; error: string; internalError?: unknown };

export type ReauthState = {
  workspaceId: string;
  accountId: string;
  sessionId: string;
} & ReauthStateData;

export type WarmupStage = "initial" | "engagement" | "maintenance";

export type WarmupSessionAction = {
  id: string;
  type: string;
  params: unknown;
  status: "pending" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  subActions?: WarmupSessionAction[];
};

export type WarmupSession = {
  workspaceId: string;
  accountId: string;
  status: "pending" | "running" | "completed" | "failed";
  executionDate: Timestamp;
  stage: WarmupStage;
  actions: WarmupSessionAction[];
};
export type WarmupSessionWithId = WithId<WarmupSession>;

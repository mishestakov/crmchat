import * as z from "zod";

import { Timestamp } from "./common";

export const WebhookEventTypeSchema = z.enum([
  "contact.created",
  "contact.updated",
  "contact.deleted",
]);
export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;

export const WebhookStatusSchema = z.enum(["active", "disabled"]);
export type WebhookStatus = z.infer<typeof WebhookStatusSchema>;

export interface Webhook {
  type: "user";
  name: string;
  url: string;
  events: WebhookEventType[];
  workspaceIds: string[];
  status: WebhookStatus;
  signingSecret: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastDeliveredAt?: Timestamp;
  lastFailureReason?: string;
}

export interface WebhookSubscription {
  type: "user";
  userId: string;
  webhookId: string;
  events: WebhookEventType[];
  url: string;
}

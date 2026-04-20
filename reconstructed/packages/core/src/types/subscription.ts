import * as z from "zod";

import { timestampField } from "./common";

export const subscriptionPlans = ["pro", "team", "outreach"] as const;
export const subscriptionPlanSchema = z.enum(subscriptionPlans);
export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>;

const subscriptionItemSchema = z.object({
  itemId: z.string(),
  priceId: z.string(),
});

const baseSubscriptionFields = {
  active: z.boolean(),
  status: z.enum([
    "active",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "past_due",
    "paused",
    "trialing",
    "unpaid",
  ]),
  trialing: z.boolean(),
  currentPeriodStartsAt: timestampField().optional(),
  currentPeriodEndsAt: timestampField().optional(),
  trialEndsAt: timestampField().nullable().optional(),
  canceledAt: timestampField().nullable().optional(),
  cancelsAt: timestampField().nullable().optional(),
  plan: subscriptionPlanSchema.optional(),
  billingPeriod: z.enum(["month", "year"]).optional(),
};

export const SubscriptionSchema = z.discriminatedUnion("platform", [
  z.object({
    ...baseSubscriptionFields,
    platform: z.literal("stripe"),
    subscriptionId: z.string(),
    customerId: z.string(),
    priceId: z.string(),
    subscriptionItems: z
      .object({
        base: subscriptionItemSchema.optional(),
        members: subscriptionItemSchema.optional(),
        telegramAccounts: subscriptionItemSchema.optional(),
      })
      .optional(),
  }),
  z.object({
    ...baseSubscriptionFields,
    platform: z.literal("telegram"),
    lastTelegramChargeId: z.string(),
    lastPaymentProviderChargeId: z.string(),
  }),
]);

export type Subscription = z.infer<typeof SubscriptionSchema>;

export type SubscriptionItemType = "base" | "members" | "telegramAccounts";

export interface SubscriptionItem {
  itemId: string;
  priceId: string;
}

// Backward-compatible type aliases for platform-specific subscriptions
export type StripeSubscription = Extract<Subscription, { platform: "stripe" }>;
export type TelegramSubscription = Extract<
  Subscription,
  { platform: "telegram" }
>;

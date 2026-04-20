import type { Subscription } from "../types/subscription.js";

export function isLegacyPlan(subscription: Subscription | undefined): boolean {
  if (!subscription?.active || subscription.platform !== "stripe") return false;
  if (subscription.plan === "outreach") return true;
  if (subscription.plan !== "team") return false;
  return (
    !subscription.subscriptionItems?.members &&
    !subscription.subscriptionItems?.telegramAccounts
  );
}

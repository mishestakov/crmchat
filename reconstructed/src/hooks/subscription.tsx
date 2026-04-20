import { isLegacyPlan } from "@repo/core/utils";

import {
  useActiveSubscription,
  useCurrentOrganization,
  useCurrentWorkspace,
  useWorkspaceStore,
} from "@/lib/store";

export function useHasReachedContactLimit() {
  const hasActiveSubscription = useActiveSubscription((s) => !!s);
  const contactCount = useWorkspaceStore((state) => state.contacts.length);
  return !hasActiveSubscription && contactCount >= 50;
}

export function useCanCreateContact() {
  return !useHasReachedContactLimit();
}

export function useCanUseChat() {
  return !useHasReachedContactLimit();
}

export function useCanUseTeamFeatures() {
  const plan = useActiveSubscription((s) => s.plan);
  return plan === "team" || plan === "outreach";
}

export type TelegramAccountCreationGate =
  | { allowed: true }
  | { allowed: false; reason: "plan" | "orgLimit" };

export function useCanCreateTelegramAccount(): TelegramAccountCreationGate {
  const currentCount = useCurrentOrganization(
    (o) => o.activeTelegramAccountsCount ?? 0
  );
  const orgLimit = useCurrentOrganization((o) => o.telegramAccountsLimit);

  const plan = useActiveSubscription((s) => s.plan);
  const isLegacy = useActiveSubscription(isLegacyPlan);

  // Org-level manual limit takes precedence over plan rules.
  if (orgLimit !== undefined && currentCount >= orgLimit) {
    return { allowed: false, reason: "orgLimit" };
  }

  // 1 account is free for all plans
  if (currentCount === 0) {
    return { allowed: true };
  }

  // Free and Pro plans: only 1 account
  if (!plan || plan === "pro") {
    return { allowed: false, reason: "plan" };
  }

  // Legacy team plan: no more than 1 account
  if (plan === "team" && isLegacy) {
    return { allowed: false, reason: "plan" };
  }

  return { allowed: true };
}

export function useCanUseSequences() {
  const plan = useActiveSubscription((s) => s.plan);
  const accountCount = useCurrentOrganization(
    (s) => s.activeTelegramAccountsCount ?? 0
  );
  const excludedFromBilling = useCurrentWorkspace(
    (s) => !!s.excludeFromAccountBilling
  );
  if (excludedFromBilling) {
    return false;
  }
  return accountCount <= 1 || plan === "team" || plan === "outreach";
}

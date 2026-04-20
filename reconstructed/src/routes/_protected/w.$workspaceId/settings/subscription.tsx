import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { CheckIcon, PlusIcon } from "lucide-react";
import { m } from "motion/react";
import { title } from "radashi";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";
import { useShallow } from "zustand/react/shallow";

import {
  Subscription,
  SubscriptionPlan,
  subscriptionPlanSchema,
  subscriptionPlans,
} from "@repo/core/types";
import { isLegacyPlan } from "@repo/core/utils";

import { LoadingScreen } from "@/components/LoadingScreen";
import { ResponsivePage } from "@/components/mini-app-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { Switch } from "@/components/ui/switch";
import { getCachedApiUrlOrFallback } from "@/config";
import { useIdToken } from "@/hooks/useIdToken";
import { useUser } from "@/hooks/useUser";
import { useCurrentWorkspace } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/subscription"
)({
  component: SubscriptionPage,
  validateSearch: z.object({
    organizationId: z.string().optional(),
    // eslint-disable-next-line unicorn/prefer-top-level-await
    minPlan: subscriptionPlanSchema.optional().catch(undefined),
  }),
});

function SubscriptionPage() {
  const { t } = useTranslation();

  const search = Route.useSearch();

  const searchOrganizationId = search.organizationId;
  const currentOrganizationId = useCurrentWorkspace(
    (state) => state.organizationId
  );
  const organizationId = searchOrganizationId ?? currentOrganizationId;

  const subscription = useWorkspacesStore(
    useShallow((state) => {
      const organization = state.organizationsById[organizationId];
      return organization?.subscription?.active
        ? organization.subscription
        : undefined;
    })
  );
  const idToken = useIdToken();

  return (
    <ResponsivePage className="mx-3 flex flex-col gap-6">
      {subscription && (
        <Section className="mx-auto w-full max-w-md">
          <SectionHeader>{t("web.subscriptionPage.header")}</SectionHeader>
          <SectionItems>
            <SectionItem asChild icon={null}>
              <div>
                <SectionItemTitle>
                  {title(subscription.plan)}{" "}
                  <span className="text-muted-foreground text-xs">
                    {t(
                      `web.subscriptionPage.billingPeriodLabel${title(subscription.billingPeriod)}`
                    )}
                  </span>
                </SectionItemTitle>
                <SectionItemValue>
                  {t(
                    `web.subscriptionPage.status.${subscription.status}`,
                    title(subscription.status)
                  )}
                </SectionItemValue>
              </div>
            </SectionItem>
            {subscription.cancelsAt && (
              <SectionItem asChild icon={null}>
                <div>
                  <SectionItemTitle>
                    {t("web.subscriptionPage.cancelsLabel")}
                  </SectionItemTitle>
                  <SectionItemValue>
                    {format(subscription.cancelsAt.toDate(), "MMM d, yyyy")}
                  </SectionItemValue>
                </div>
              </SectionItem>
            )}
            {subscription.platform === "stripe" && (
              <SectionItem asChild>
                <a
                  href={`${getCachedApiUrlOrFallback()}/stripe/portal?idToken=${encodeURIComponent(idToken ?? "")}&organizationId=${organizationId ?? ""}`}
                  target="_blank"
                >
                  <SectionItemTitle>
                    {t("web.subscriptionPage.manageButton")}
                  </SectionItemTitle>
                </a>
              </SectionItem>
            )}
          </SectionItems>
        </Section>
      )}
      <PricingTable
        idToken={idToken}
        organizationId={organizationId}
        subscription={subscription}
        minPlan={search.minPlan}
      />
    </ResponsivePage>
  );
}

type BillingCycle = "monthly" | "yearly";

type PriceInfo = {
  id: string;
  currency: string;
  unitAmount: number | null;
  tiers_mode: string | null;
  tiers?: Array<{
    up_to: number | null;
    flat_amount: number | null;
    unit_amount: number | null;
  }>;
};

type MultiItemPricing = {
  product: { name: string; description: string; features: string[] };
  base: PriceInfo;
  members: PriceInfo;
  telegramAccounts: PriceInfo;
};

type SingleItemPricing = PriceInfo & {
  product: { name: string; description: string; features: string[] };
};

function isMultiItemPricing(
  pricing: MultiItemPricing | SingleItemPricing
): pricing is MultiItemPricing {
  return "base" in pricing;
}

function PricingTable({
  idToken,
  organizationId,
  subscription,
  minPlan,
}: {
  idToken?: string;
  organizationId: string;
  subscription: Subscription | undefined;
  minPlan?: SubscriptionPlan;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const user = useUser();

  const { data: pricing, isPending } = useQuery(
    trpc.workspace.subscription.getPrices.queryOptions()
  );

  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  const prices = pricing?.cycles[billingCycle];

  const plans = ["pro", "team"] as const;

  const hasLegacyOutreach =
    subscription?.active && subscription.plan === "outreach";

  const trialDays = user?.referredBy ? 30 : 7;

  if (!organizationId || isPending) {
    return <LoadingScreen />;
  }

  if (!prices) {
    return null;
  }

  const hasYearlyPricing = !!pricing?.cycles.yearly;

  const getBaseMonthlyPrice = (
    planPricing: MultiItemPricing | SingleItemPricing
  ) => {
    const amount = isMultiItemPricing(planPricing)
      ? (planPricing.base.unitAmount ?? 0)
      : (planPricing.unitAmount ?? 0);
    return amount / 100 / (billingCycle === "yearly" ? 12 : 1);
  };

  const returnTo = webApp ? undefined : location.pathname + location.search;

  const checkoutUrl = (plan: SubscriptionPlan) =>
    `${getCachedApiUrlOrFallback()}/stripe/checkout?idToken=${encodeURIComponent(idToken ?? "")}&organizationId=${organizationId ?? ""}&plan=${plan}&period=${billingCycle}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`;

  const portalUrl = `${getCachedApiUrlOrFallback()}/stripe/portal?idToken=${encodeURIComponent(idToken ?? "")}&organizationId=${organizationId ?? ""}`;

  const featureHeaders: Partial<Record<string, string>> = {
    team: t("web.subscriptionPage.pricingTable.featureHeaderTeam"),
  };

  return (
    <div className="mt-3 flex flex-col items-center space-y-6">
      {/* Billing toggle */}
      {hasYearlyPricing && (
        <label className="bg-card flex cursor-pointer items-center gap-3 rounded-full px-4 py-2">
          <span
            className={cn(
              "text-sm font-medium",
              billingCycle === "monthly"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {t("web.subscriptionPage.pricingTable.monthlyLabel")}
          </span>
          <Switch
            checked={billingCycle === "yearly"}
            onCheckedChange={(checked) =>
              setBillingCycle(checked ? "yearly" : "monthly")
            }
          />
          <span
            className={cn(
              "text-sm font-medium",
              billingCycle === "yearly"
                ? "text-foreground"
                : "text-muted-foreground"
            )}
          >
            {t("web.subscriptionPage.pricingTable.yearlyLabel")}
          </span>
          <Badge variant="pink">
            {t("web.subscriptionPage.pricingTable.saveBadge")}
          </Badge>
        </label>
      )}

      {/* Plan cards grid */}
      <div className="mx-auto grid w-full max-w-md grid-cols-1 gap-4 lg:max-w-6xl lg:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan, index) => {
          const rawPricing = prices[plan];
          if (!rawPricing) return null;

          const planPricing = rawPricing as
            | MultiItemPricing
            | SingleItemPricing;
          const monthlyPrice = getBaseMonthlyPrice(planPricing);
          const multiItem = isMultiItemPricing(planPricing)
            ? planPricing
            : null;

          const featureHeader = featureHeaders[plan];
          const isCurrentPlan =
            subscription?.active && plan === subscription?.plan;
          const isDisabled =
            minPlan &&
            subscriptionPlans.indexOf(plan) <
              subscriptionPlans.indexOf(minPlan);

          return (
            <m.div
              key={plan}
              id={`plan-${plan}`}
              className={cn(
                "bg-card row-span-4 grid grid-rows-subgrid gap-6 rounded-lg border p-6",
                isDisabled && "pointer-events-none"
              )}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: isDisabled ? 0.3 : 1, scale: 1 }}
              transition={{
                delay: 0.3 + index * 0.1,
              }}
            >
              <div>
                <h2 className="text-xl font-medium">
                  {planPricing.product.name}
                </h2>
                {planPricing.product.description && (
                  <p className="text-muted-foreground mt-1 text-sm">
                    {planPricing.product.description}
                  </p>
                )}
              </div>

              {isCurrentPlan ? (
                <section className="text-badge-pink-foreground flex items-end justify-start text-2xl font-semibold">
                  {t("web.subscriptionPage.pricingTable.currentPlan")}
                </section>
              ) : (
                <section className="flex flex-col items-start justify-end">
                  <div className="text-muted-foreground mb-0.5 text-sm">
                    {multiItem
                      ? t("web.subscriptionPage.pricingTable.from")
                      : "\u00A0"}
                  </div>
                  <div>
                    <span className="text-4xl font-semibold">
                      ${monthlyPrice.toFixed(0)}
                    </span>
                    <span className="text-muted-foreground text-2xl">
                      {" "}
                      {t("web.subscriptionPage.pricingTable.pricePerMonthLong")}
                    </span>
                  </div>
                </section>
              )}

              <div className="flex flex-col items-stretch gap-2">
                {isCurrentPlan ? (
                  <>
                    <Button
                      variant="secondary"
                      className="rounded-full"
                      asChild
                    >
                      <a href={portalUrl} target="_blank">
                        {t("web.subscriptionPage.manageButton")}
                      </a>
                    </Button>
                    {isLegacyPlan(subscription) && (
                      <SwitchPlanDialog
                        organizationId={organizationId}
                        plan={plan}
                        planName={planPricing.product.name}
                        period={billingCycle}
                      >
                        <button className="text-muted-foreground text-xs underline">
                          {t("web.subscriptionPage.pricingTable.migrateLegacy")}
                        </button>
                      </SwitchPlanDialog>
                    )}
                  </>
                ) : subscription?.active ? (
                  <SwitchPlanDialog
                    organizationId={organizationId}
                    plan={plan}
                    planName={planPricing.product.name}
                    period={billingCycle}
                  >
                    <Button
                      variant={
                        subscription.plan &&
                        subscriptionPlans.indexOf(plan) <
                          subscriptionPlans.indexOf(subscription.plan)
                          ? "secondary"
                          : "default"
                      }
                      className="rounded-full"
                    >
                      {t("web.subscriptionPage.pricingTable.switchPlanButton")}
                    </Button>
                  </SwitchPlanDialog>
                ) : (
                  <Button className="rounded-full" asChild>
                    <a href={checkoutUrl(plan)} target="_blank">
                      {t("web.subscriptionPage.pricingTable.startTrialButton", {
                        days: trialDays,
                      })}
                    </a>
                  </Button>
                )}
              </div>

              <div>
                <ul className="space-y-2">
                  {featureHeader && (
                    <li className="flex items-start space-x-2 text-sm font-semibold">
                      <PlusIcon className="text-primary size-5 shrink-0" />
                      <div>{featureHeader}</div>
                    </li>
                  )}
                  {(
                    t(`text.subscription.features_${plan}`, {
                      returnObjects: true,
                    }) as string[]
                  ).map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start space-x-2 text-sm"
                    >
                      <CheckIcon className="text-primary size-5 shrink-0" />
                      <div>{feature}</div>
                    </li>
                  ))}
                  {multiItem?.members.tiers?.[1] && (
                    <li className="flex items-start space-x-2 text-sm">
                      <CheckIcon className="text-primary size-5 shrink-0" />
                      <div>
                        {t("web.subscriptionPage.pricingTable.upToUsers", {
                          count: multiItem.members.tiers[0]?.up_to ?? 0,
                        })}
                        {t("web.subscriptionPage.pricingTable.additionalUser", {
                          price: `$${
                            (multiItem.members.tiers[1].unit_amount ?? 0) /
                            100 /
                            (billingCycle === "yearly" ? 12 : 1)
                          }`,
                          perUser: t(
                            "web.subscriptionPage.pricingTable.perUser"
                          ),
                        })}
                      </div>
                    </li>
                  )}
                  {multiItem && (
                    <li className="flex items-start space-x-2 text-sm">
                      <CheckIcon className="text-primary size-5 shrink-0" />
                      <div>
                        {t(
                          "web.subscriptionPage.pricingTable.telegramAccountsIncluded"
                        )}
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            </m.div>
          );
        })}

        {/* Agency card — always shown, static */}
        <m.div
          id="plan-agency"
          className="bg-card row-span-4 grid grid-rows-subgrid gap-6 rounded-lg border p-6"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 + plans.length * 0.1 }}
        >
          <div>
            <h2 className="text-xl font-medium">
              {t("text.subscription.plan_agency")}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {t("text.subscription.description_agency")}
            </p>
          </div>

          <section className="flex flex-col items-start justify-end">
            <div className="text-muted-foreground text-sm">{"\u00A0"}</div>
            <span className="text-2xl font-semibold">
              {t("web.subscriptionPage.pricingTable.talkToUs")}
            </span>
          </section>

          <div className="flex flex-col items-stretch gap-2">
            <Button className="rounded-full" asChild>
              <a href="https://calendly.com/hints/intro" target="_blank">
                {t("web.subscriptionPage.pricingTable.talkToUs")}
              </a>
            </Button>
          </div>

          <div>
            <ul className="space-y-2">
              <li className="flex items-start space-x-2 text-sm font-semibold">
                <PlusIcon className="text-primary size-5 shrink-0" />
                <div>
                  {t("web.subscriptionPage.pricingTable.featureHeaderOutreach")}
                </div>
              </li>
              {(
                t("text.subscription.features_agency", {
                  returnObjects: true,
                }) as string[]
              ).map((feature) => (
                <li
                  key={feature}
                  className="flex items-start space-x-2 text-sm"
                >
                  <CheckIcon className="text-primary size-5 shrink-0" />
                  <div>{feature}</div>
                </li>
              ))}
            </ul>
          </div>
        </m.div>

        {/* Legacy outreach card — only shown if org has active outreach subscription */}
        {hasLegacyOutreach && (
          <m.div
            id="plan-outreach-legacy"
            className="bg-card row-span-4 grid grid-rows-subgrid gap-6 rounded-lg border p-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              delay: 0.3 + (plans.length + 1) * 0.1,
            }}
          >
            <div>
              <h2 className="text-xl font-medium">
                {t("text.subscription.plan_outreach")}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("text.subscription.description_outreach")}
              </p>
            </div>

            <section className="text-badge-pink-foreground flex items-end justify-start text-2xl font-semibold">
              {t("web.subscriptionPage.pricingTable.currentPlan")}
            </section>

            <div className="flex flex-col items-stretch gap-2">
              <Button variant="secondary" className="rounded-full" asChild>
                <a href={portalUrl} target="_blank">
                  {t("web.subscriptionPage.manageButton")}
                </a>
              </Button>
            </div>

            <div />
          </m.div>
        )}
      </div>
    </div>
  );
}

function SwitchPlanDialog({
  organizationId,
  plan,
  planName,
  period,
  children,
}: {
  organizationId: string;
  plan: "pro" | "team";
  planName: string;
  period: BillingCycle;
  children: React.ReactNode;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const organization = useWorkspacesStore(
    (state) => state.organizationsById[organizationId]
  );

  const switchPlanMutation = useMutation(
    trpc.workspace.subscription.switchPlan.mutationOptions({
      onSuccess: () => {
        setOpen(false);
        toast.success(t("web.subscriptionPage.switchPlanDialog.success"));
      },
      onError: () => {
        toast.error(t("web.subscriptionPage.switchPlanDialog.error"));
      },
    })
  );

  const membersCount = organization?.membersCount ?? 0;
  const telegramAccountsCount = organization?.activeTelegramAccountsCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("web.subscriptionPage.switchPlanDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("web.subscriptionPage.switchPlanDialog.description", {
              plan: planName,
            })}
          </DialogDescription>
        </DialogHeader>
        {plan === "team" && (
          <div className="space-y-3">
            <div className="bg-muted/50 flex flex-col gap-2 rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("web.subscriptionPage.switchPlanDialog.membersLabel")}
                </span>
                <span className="font-medium">{membersCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t(
                    "web.subscriptionPage.switchPlanDialog.telegramAccountsLabel"
                  )}
                </span>
                <span className="font-medium">{telegramAccountsCount}</span>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">
              {t("web.subscriptionPage.switchPlanDialog.teamNote")}{" "}
              <a
                href={t("web.subscriptionPage.switchPlanDialog.pricingUrl")}
                target="_blank"
                className="text-primary underline"
              >
                {t("web.subscriptionPage.switchPlanDialog.viewPricing")}
              </a>
            </p>
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">
              {t("web.subscriptionPage.switchPlanDialog.cancel")}
            </Button>
          </DialogClose>
          <Button
            disabled={switchPlanMutation.isPending}
            onClick={() =>
              switchPlanMutation.mutate({ organizationId, plan, period })
            }
          >
            {t("web.subscriptionPage.switchPlanDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { differenceInHours, format } from "date-fns";
import { CheckIcon, Flame, ShieldAlert, ShieldCheckIcon } from "lucide-react";
import { capitalize, clamp } from "radashi";
import { Suspense, lazy, useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePhoneNumber } from "react-phone-number-input";
import { toast } from "sonner";
import * as z from "zod";

import { TelegramAccountWithId } from "@repo/core/types";

import premiumIcon from "@/assets/telegram-premium.png";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { SimpleForm } from "@/components/simple-form";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import Loader from "@/components/ui/loader";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { deleteTelegramAccount, getNextWarmupSession } from "@/lib/db/telegram";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const WarmupDebugDialog = lazy(() =>
  import(
    "@/features/outreach/telegram-accounts/warmup/warmup-debug-dialog"
  ).then((mod) => ({
    default: mod.WarmupDebugDialog,
  }))
);

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/telegram-accounts/$accountId"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { accountId } = Route.useParams();
  const { t } = useTranslation();
  const account = useWorkspaceStore((s) => s.telegramAccountsById[accountId]);
  const { data: proxyStatus, isPending: isProxyStatusPending } = useQuery(
    trpc.proxy.getProxyStatus.queryOptions(
      {
        workspaceId: account?.workspaceId ?? "",
        accountId: account?.id ?? "",
      },
      {
        enabled: !!account?.workspaceId && !!account?.id,
      }
    )
  );

  if (!account) {
    return null;
  }

  return (
    <MiniAppPage className="flex flex-col gap-4" workspaceSelector={false}>
      <OutreachTabNavigation />
      <Section>
        <SectionHeader>
          {t("web.outreach.telegramAccounts.account.header")}
        </SectionHeader>
        <SectionItems>
          <SectionItem asChild icon={null} className="hover:bg-card">
            <div>
              <SectionItemTitle className="flex flex-col items-start">
                <span className="flex items-center gap-1 text-lg">
                  <span>{account.telegram.fullName}</span>
                  {account.telegram.hasPremium && (
                    <img src={premiumIcon} className="size-5" />
                  )}
                </span>
                <span className="text-muted-foreground flex items-center gap-1.5 font-normal">
                  <span>
                    {parsePhoneNumber(
                      "+" + account.telegram.phone
                    )?.formatInternational()}
                  </span>
                  {account.telegram.username && (
                    <>
                      <span className="text-foreground">•</span>
                      <span>@{account.telegram.username}</span>
                    </>
                  )}
                </span>
              </SectionItemTitle>
            </div>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionItems>
          <SectionItem asChild icon={null}>
            <div>
              <SectionItemTitle>
                {t("web.outreach.telegramAccounts.account.statusLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                {capitalize(account?.status ?? "")}
              </SectionItemValue>
            </div>
          </SectionItem>

          <SectionItem asChild icon={null}>
            <div>
              <SectionItemTitle>
                {t("web.outreach.telegramAccounts.account.proxyCountryLabel")}
              </SectionItemTitle>
              <SectionItemValue className="gap-1">
                {isProxyStatusPending ? (
                  <Loader className="size-4" />
                ) : (
                  <>
                    {proxyStatus?.active ? (
                      <ShieldCheckIcon className="size-4 text-green-500" />
                    ) : (
                      <ShieldAlert className="size-4 text-red-500" />
                    )}
                    <span>{proxyStatus?.countryName}</span>
                  </>
                )}
              </SectionItemValue>
            </div>
          </SectionItem>
          <SignOutDialog account={account} />
        </SectionItems>
      </Section>

      <WarmupSection account={account} />

      <ContactCreationBeahaviourForm account={account} />
      <NewLeadsDailyLimitForm account={account} />
    </MiniAppPage>
  );
}

function ContactCreationBeahaviourForm({
  account,
}: {
  account: TelegramAccountWithId;
}) {
  useFormFeatures();
  const trpc = useTRPC();
  const { t } = useTranslation();

  const activeWorkspaceId = useCurrentWorkspace((state) => state.id);
  const { mutateAsync } = useMutation(
    trpc.telegram.account.updateAccount.mutationOptions()
  );

  return (
    <SimpleForm
      label={t("web.outreach.telegramAccounts.account.autoCreationLabel")}
      value={account.contactCreationBehaviour ?? "disabled"}
      valueSchema={z.enum(["disabled", "message-received"])}
      onSubmit={async (behaviour) => {
        await mutateAsync({
          workspaceId: activeWorkspaceId,
          accountId: account.id,
          contactCreationBehaviour: behaviour,
        });
      }}
      children={(field) => (
        <field.ComboboxInput
          className="font-medium"
          options={[
            {
              label: t(
                "web.outreach.telegramAccounts.account.autoCreationDisabled"
              ),
              value: "disabled",
            },
            {
              label: t(
                "web.outreach.telegramAccounts.account.autoCreationOnReply"
              ),
              value: "message-received",
            },
          ]}
        />
      )}
    />
  );
}

function NewLeadsDailyLimitForm({
  account,
}: {
  account: TelegramAccountWithId;
}) {
  useFormFeatures();
  const trpc = useTRPC();
  const { t } = useTranslation();

  const activeWorkspaceId = useCurrentWorkspace((state) => state.id);
  const { mutateAsync } = useMutation(
    trpc.telegram.account.updateAccount.mutationOptions()
  );

  const { mutate: rescheduleSequences } = useMutation(
    trpc.outreach.rescheduleSequences.mutationOptions()
  );

  return (
    <SimpleForm
      label={t("web.outreach.telegramAccounts.account.dailyLimitLabel")}
      value={account.newLeadsDailyLimit ?? 0}
      valueSchema={z.coerce.number().min(0).max(500)}
      onSubmit={async (limit) => {
        await mutateAsync({
          workspaceId: activeWorkspaceId,
          accountId: account.id,
          newLeadsDailyLimit: limit,
        });
        rescheduleSequences({ workspaceId: activeWorkspaceId });
        toast.success(
          t("web.outreach.telegramAccounts.account.dailyLimitUpdated"),
          {
            description: t(
              "web.outreach.telegramAccounts.account.dailyLimitUpdatedDescription"
            ),
          }
        );
      }}
      children={(field) => (
        <field.TextInput className="font-medium" type="number" />
      )}
    />
  );
}

function SignOutDialog({ account }: { account: TelegramAccountWithId }) {
  const navigateBack = useNavigateBack();
  const { t } = useTranslation();

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <SectionItem>
          <SectionItemTitle>{t("web.signOut")}</SectionItemTitle>
        </SectionItem>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription>
            {t("web.outreach.telegramAccounts.account.signOutDescription")}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            onClick={async () => {
              await deleteTelegramAccount(account.workspaceId, account.id);

              navigateBack({
                fallback: {
                  to: "/w/$workspaceId/outreach/telegram-accounts",
                  params: { workspaceId: account.workspaceId },
                  replace: true,
                },
              });
            }}
          >
            {t("web.signOut")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function WarmupSection({ account }: { account: TelegramAccountWithId }) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { mutate, isPending } = useMutation(
    trpc.telegram.account.toggleWarmup.mutationOptions({
      onError: () => {
        toast.error(t("web.common.error.somethingWentWrong"));
      },
    })
  );

  const [, setClicks] = useState(0);
  const [showDebug, setShowDebug] = useState(false);

  const enabled = account.warmup?.enabled ?? false;

  if (account.warmupHelper) {
    return null;
  }

  return (
    <>
      <Section className="overflow-hidden">
        <AnimateChangeInHeight>
          <SectionItems>
            <SectionItem asChild icon={null} className="hover:bg-card">
              <div>
                <button
                  type="button"
                  className={cn(
                    "rounded-xl p-2 transition-all active:scale-95",
                    enabled
                      ? account.warmup?.stage === "maintenance"
                        ? "rotate-6 bg-green-600 text-white shadow-md shadow-green-500/30"
                        : "rotate-6 bg-orange-500 text-white shadow-md shadow-orange-500/30"
                      : "bg-muted text-muted-foreground"
                  )}
                  onClick={() => {
                    setClicks((c) => {
                      const next = c + 1;
                      if (next >= 10) {
                        setShowDebug(true);
                        return 0;
                      }
                      return next;
                    });
                  }}
                >
                  {enabled && account.warmup?.stage === "maintenance" ? (
                    <CheckIcon className={cn("size-6")} />
                  ) : (
                    <Flame
                      className={cn("size-6", enabled && "animate-pulse")}
                    />
                  )}
                </button>
                <SectionItemTitle>
                  {t("web.outreach.telegramAccounts.account.warmup.title")}
                </SectionItemTitle>
                <SectionItemValue>
                  <Button
                    variant={enabled ? "secondary" : "warmup"}
                    size="xs"
                    shape="circled"
                    className="grid place-items-center px-4 [grid-template-areas:'stack']"
                    onClick={(e) => {
                      e.stopPropagation();

                      if (!account.telegram.username) {
                        toast.error(
                          t(
                            "web.outreach.telegramAccounts.account.warmup.usernameNotSetError"
                          )
                        );
                        return;
                      }
                      mutate({
                        workspaceId: account.workspaceId,
                        accountId: account.id,
                        enabled: !enabled,
                      });
                    }}
                    disabled={isPending}
                  >
                    <span
                      className={cn("[grid-area:stack]", !enabled && "hidden")}
                    >
                      {t("web.outreach.telegramAccounts.account.warmup.stop")}
                    </span>
                    <span
                      className={cn("[grid-area:stack]", enabled && "hidden")}
                    >
                      {t("web.outreach.telegramAccounts.account.warmup.start")}
                    </span>
                  </Button>
                </SectionItemValue>
              </div>
            </SectionItem>
            {enabled && <WarmupProgress account={account} />}
          </SectionItems>
        </AnimateChangeInHeight>
      </Section>
      <Suspense fallback={null}>
        {showDebug && (
          <WarmupDebugDialog onOpenChange={setShowDebug} account={account} />
        )}
      </Suspense>
    </>
  );
}

function WarmupProgress({ account }: { account: TelegramAccountWithId }) {
  const { t } = useTranslation();
  const { data: nextSession } = useQuery({
    queryKey: ["next-warmup-session", account.workspaceId, account.id],
    queryFn: () => getNextWarmupSession(account.workspaceId, account.id),
  });

  if (!account.warmup?.enabled || !account.warmup.startedAt) {
    return null;
  }

  const isMaintenance = account.warmup.stage === "maintenance";
  const startDate = account.warmup.startedAt.toDate();
  const now = new Date();

  // Total duration: 14 days (3 initial + 11 engagement)
  const totalDays = 14;
  const progressPercent = isMaintenance
    ? 100
    : clamp(
        (differenceInHours(now, startDate) / (totalDays * 24)) * 100,
        1,
        99
      );

  return (
    <div className="bg-card w-full rounded-b-lg px-3 py-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            {t(
              `web.outreach.telegramAccounts.account.warmup.stages.${account.warmup.stage}.title`
            )}
          </h3>
          <p className="text-muted-foreground text-xs">
            {t(
              `web.outreach.telegramAccounts.account.warmup.stages.${account.warmup.stage}.description`
            )}
          </p>
        </div>

        <div className="bg-background relative flex h-2 w-full overflow-hidden rounded-full">
          <div className="h-full w-[21.4%]" />
          <div className="h-full w-full" />

          {/* Progress Fill */}
          <div
            className={cn(
              "pointer-events-none absolute left-0 top-0 h-full rounded-full transition-all duration-500",
              isMaintenance ? "bg-green-600" : "bg-blue-500"
            )}
            style={{ width: `${progressPercent}%` }}
          />

          {/* Separator - positioned on top of the fill */}
          {!isMaintenance && (
            <div
              className="border-card absolute bottom-0 top-0 w-0 border-l-2"
              style={{ left: `${(3 / 14) * 100}%` }}
            />
          )}
        </div>

        <div className="text-muted-foreground flex justify-between text-xs">
          <span>
            {nextSession && (
              <>
                {t("web.outreach.telegramAccounts.account.warmup.nextAction")}{" "}
                {format(nextSession.executionDate.toDate(), "MMM d, HH:mm")}
              </>
            )}
          </span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
      </div>
    </div>
  );
}

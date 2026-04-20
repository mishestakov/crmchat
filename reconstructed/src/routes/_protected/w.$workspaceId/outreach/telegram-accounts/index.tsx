import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2Icon,
  CheckIcon,
  FlameIcon,
  Plus,
  XIcon,
} from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePhoneNumber } from "react-phone-number-input";

import type { TelegramAccountWithId } from "@repo/core/types";

import telegramIcon from "@/assets/telegram-logo.svg";
import premiumIcon from "@/assets/telegram-premium.png";
import { AccountStatusIndicator } from "@/components/account-status-indicator";
import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { Tip } from "@/components/ui/tooltip";
import { TELEGRAM_ACCOUNT_PRICE_USD } from "@/config";
import { MoveTelegramAccountsDialog } from "@/features/outreach/telegram-accounts/move-accounts-dialog";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/telegram-accounts/"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const accounts = useWorkspaceStore((state) => state.telegramAccounts);
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { t } = useTranslation();
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState(new Set<string>());

  const toggleSelection = (accountId: string) => {
    setSelectedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedAccounts(new Set());
  };

  return (
    <MiniAppPage className="flex flex-col gap-4">
      <OutreachTabNavigation />
      <Section>
        <SectionHeader className="mr-0 flex items-center justify-between">
          <span>{t("web.outreach.telegramAccounts.title")}</span>
          {accounts.length > 0 && (
            <Button
              size="xs"
              variant="secondary"
              className={cn(
                "bg-card hover:bg-card/70 h-6 gap-1 rounded-full border-2 border-transparent px-2",
                isSelectionMode && "text-destructive"
              )}
              onClick={() =>
                isSelectionMode ? exitSelectionMode() : setIsSelectionMode(true)
              }
            >
              {isSelectionMode ? (
                <XIcon className="size-4" />
              ) : (
                <CheckCircle2Icon className="text-muted-foreground size-4" />
              )}
              {isSelectionMode
                ? t("web.outreach.telegramAccounts.cancel")
                : t("web.outreach.telegramAccounts.select")}
            </Button>
          )}
        </SectionHeader>

        <AnimatePresence>
          {isSelectionMode && (
            <m.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              transition={{ duration: 0.2, delay: 0.4 }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-muted-foreground text-sm">
                  {t("web.outreach.telegramAccounts.selected", {
                    count: selectedAccounts.size,
                  })}
                </span>
                <MoveTelegramAccountsDialog
                  workspaceId={workspaceId}
                  accountIds={selectedAccounts}
                  onComplete={exitSelectionMode}
                  disabled={selectedAccounts.size === 0}
                />
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <SectionItems>
          {accounts.map((account) => (
            <SectionItem
              key={account.id}
              asChild
              onClick={
                isSelectionMode
                  ? (e: React.MouseEvent) => {
                      e.preventDefault();
                      toggleSelection(account.id);
                    }
                  : undefined
              }
            >
              <Link
                from={Route.fullPath}
                to="./$accountId"
                params={{ accountId: account.id }}
              >
                <AnimatePresence initial={false}>
                  {isSelectionMode && (
                    <m.label
                      className="-mr-2"
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Checkbox
                        checked={selectedAccounts.has(account.id)}
                        className="mr-2"
                      />
                    </m.label>
                  )}
                </AnimatePresence>
                <AccountItemContent account={account} />
                {account.warmup?.enabled && (
                  <SectionItemValue>
                    {account.warmup.stage === "maintenance" ? (
                      <div className="rounded-md bg-green-600 p-1 text-white">
                        <CheckIcon className="size-4" />
                      </div>
                    ) : (
                      <div className="rounded-md bg-orange-500 p-1 text-white">
                        <FlameIcon className="size-4" />
                      </div>
                    )}
                  </SectionItemValue>
                )}
              </Link>
            </SectionItem>
          ))}

          <SectionItem
            asChild
            className={cn(
              "text-muted-foreground hover:text-foreground transition-opacity",
              isSelectionMode && "pointer-events-none opacity-60"
            )}
          >
            <Link from={Route.fullPath} to="./new">
              <Plus className="text-muted-foreground mx-0.5 size-4" />
              <SectionItemTitle className="mr-auto">
                {t("web.outreach.telegramAccounts.addAccountButton")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <BuyAccountsBanner
        className={cn(
          "transition-opacity",
          isSelectionMode && "pointer-events-none opacity-60"
        )}
      />
    </MiniAppPage>
  );
}

function AccountItemContent({ account }: { account: TelegramAccountWithId }) {
  return (
    <SectionItemTitle className="flex flex-col">
      <span className="flex items-center gap-1.5">
        <AccountStatusIndicator account={account} />
        <span>{account.telegram.fullName}</span>
        {account.telegram.hasPremium && (
          <img src={premiumIcon} className="size-4" />
        )}
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-sm font-normal">
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
      {account.warmupHelper && (
        <div>
          {account.telegram.username ? (
            <Badge variant="purple" shape="squareSmall">
              Warmup Helper
            </Badge>
          ) : (
            <Tip content="Set a username for this account">
              <Badge variant="red" shape="squareSmall">
                ⚠️ Warmup Helper
              </Badge>
            </Tip>
          )}
        </div>
      )}
    </SectionItemTitle>
  );
}

export default function BuyAccountsBanner({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("mt-2 flex flex-col gap-2", className)}>
      <div className="text-muted-foreground px-3 text-sm">
        <h3 className="text-foreground font-medium">
          {t("web.outreach.telegramAccounts.buy.banner.title")}
        </h3>
        <p>{t("web.outreach.telegramAccounts.buy.banner.description")}</p>
      </div>
      <Link
        from={Route.fullPath}
        to="./buy"
        className="bg-card hover:bg-card/70 group w-full rounded-lg px-4 py-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={telegramIcon} className="size-9" />
            <div>
              <h3 className="text-sm font-medium">
                {t("web.outreach.telegramAccounts.buy.banner.buttonText")}
              </h3>
              <span className="text-muted-foreground text-sm">
                {t("web.outreach.telegramAccounts.buy.banner.price", {
                  price: TELEGRAM_ACCOUNT_PRICE_USD,
                })}
              </span>
            </div>
          </div>

          <Button
            size="sm"
            variant="telegram"
            className="transition-all group-hover:scale-105"
          >
            {t("web.outreach.telegramAccounts.buy.banner.button")}
          </Button>
        </div>
      </Link>
    </div>
  );
}

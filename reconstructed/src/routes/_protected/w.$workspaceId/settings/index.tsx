import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { signOut } from "firebase/auth";
import { ExternalLink } from "lucide-react";
import { title } from "radashi";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { MiniAppPage } from "@/components/mini-app-page";
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
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useCelloTrigger } from "@/features/cello/cello-trigger";
import { useUser } from "@/hooks/useUser";
import { auth } from "@/lib/firebase";
import { useActiveSubscription, useCurrentWorkspace } from "@/lib/store";
import { webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";
import { cn, openExternalLink } from "@/lib/utils";

export const Route = createFileRoute("/_protected/w/$workspaceId/settings/")({
  component: SettingsPage,
});

function SettingsPage() {
  const trpc = useTRPC();
  const user = useUser();
  const [workspaceId, workspaceName, organizationId] = useCurrentWorkspace(
    useShallow((s) => [s.id, s.name, s.organizationId])
  );
  const { data: googleCalendarAccount } = useQuery(
    trpc.googleCalendar.getAccount.queryOptions()
  );
  const { t } = useTranslation();

  const [debugZoneCounter, setDebugZoneCounter] = useState(0);
  const onUserIdClick = () =>
    setDebugZoneCounter((prev) => {
      const next = prev + 1;
      if (next === 10) {
        webApp?.HapticFeedback.impactOccurred("heavy");
      }
      return next;
    });

  const subscriptionPlan = useActiveSubscription((state) => state.plan);

  const { celloClassName } = useCelloTrigger();

  return (
    <MiniAppPage className="flex flex-col gap-5 pb-6">
      <Section>
        <SectionItems>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href={t("web.help.knowledgeBaseUrl")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SectionItemTitle>{t("web.help.knowledgeBase")}</SectionItemTitle>
            </a>
          </SectionItem>

          <button className={cn("block", celloClassName)}>
            <SectionItem className="!rounded-none" asChild>
              <div>
                <SectionItemTitle>{t("web.affiliateProgram")}</SectionItemTitle>
              </div>
            </SectionItem>
          </button>

          <SectionItem asChild>
            <Link from={Route.fullPath} to="./locale">
              <SectionItemTitle>{t("web.language")}</SectionItemTitle>
              <SectionItemValue>{t("text.locale")}</SectionItemValue>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>
      <Section>
        <SectionHeader>{workspaceName}</SectionHeader>
        <SectionItems>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./workspace">
              <SectionItemTitle>{t("web.inviteTeam")}</SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link
              from={Route.fullPath}
              to="./properties/$objectType"
              params={{ objectType: "contacts" }}
            >
              <SectionItemTitle>{t("web.customProperties")}</SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./subscription">
              <SectionItemTitle>{t("web.subscription")}</SectionItemTitle>
              <SectionItemValue>
                {subscriptionPlan && title(subscriptionPlan)}
              </SectionItemValue>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./notifications">
              <SectionItemTitle>
                {t("web.notificationSettings.title")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./export">
              <SectionItemTitle>{t("web.exportData")}</SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionItems>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./workspace/new">
              <SectionItemTitle>{t("web.createWorkspace")}</SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionHeader>{t("web.integrations")}</SectionHeader>
        <SectionItems>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./telegram-sync">
              <SectionItemTitle>{t("web.telegramFolderSync")}</SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href="https://t.me/crmchatchannelbot"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SectionItemTitle>{t("web.channelSync")}</SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./connect-crm">
              <SectionItemTitle>
                {t("web.connectCrmViaZapier")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./google-calendar">
              <SectionItemTitle>{t("web.googleCalendar")}</SectionItemTitle>
              <SectionItemValue>
                {googleCalendarAccount ? t("web.connected") : ""}
              </SectionItemValue>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./api-keys">
              <SectionItemTitle>{t("web.apiKeys.title")}</SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionHeader>{t("web.about")}</SectionHeader>
        <SectionItems>
          <SectionItem asChild icon={ExternalLink}>
            <a href="https://t.me/Hints_CRM_community">
              <SectionItemTitle>{t("web.joinCommunityChat")}</SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href="https://crmchat.ai/about"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SectionItemTitle>{t("web.aboutUs")}</SectionItemTitle>
            </a>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionItems>
          <SectionItem asChild icon={ExternalLink}>
            <a href="https://crmchat.ai/privacy" onClick={openExternalLink}>
              <SectionItemTitle>{t("web.privacyPolicy")}</SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href="https://hints.so/faq/terms-and-conditions"
              onClick={openExternalLink}
            >
              <SectionItemTitle>{t("web.termsAndConditions")}</SectionItemTitle>
            </a>
          </SectionItem>

          <SectionItem icon={null} onClick={onUserIdClick} asChild>
            <div>
              <SectionItemTitle>{t("web.userId")}</SectionItemTitle>
              <SectionItemValue>{user?.id}</SectionItemValue>
            </div>
          </SectionItem>
          <SectionItem icon={null} asChild>
            <div>
              <SectionItemTitle>{t("web.workspaceId")}</SectionItemTitle>
              <SectionItemValue>{workspaceId}</SectionItemValue>
            </div>
          </SectionItem>
        </SectionItems>
      </Section>

      {webApp && (
        <Section>
          <SectionItems>
            <SectionItem
              onClick={() => {
                const url = `${import.meta.env.VITE_APP_URL}#tgWebAppData=${encodeURIComponent(
                  window.Telegram?.WebApp.initData ?? ""
                )}`;
                window.open(url);
              }}
            >
              <SectionItemTitle>{t("web.openInBrowser")}</SectionItemTitle>
            </SectionItem>
          </SectionItems>
        </Section>
      )}

      {(!webApp || import.meta.env.DEV) && (
        <Section>
          <SectionItems>
            <SectionItem onClick={() => signOut(auth)}>
              <SectionItemTitle>{t("web.logout")}</SectionItemTitle>
            </SectionItem>
          </SectionItems>
        </Section>
      )}

      {(import.meta.env.DEV || debugZoneCounter >= 10) && (
        <Section>
          <SectionHeader className="bg-destructive text-destructive-foreground inline-block px-1">
            {t("web.debugZone")}
          </SectionHeader>
          <SectionItems>
            <SectionItem icon={null} asChild>
              <div>
                <SectionItemTitle>Organization ID</SectionItemTitle>
                <SectionItemValue>{organizationId ?? "n/a"}</SectionItemValue>
              </div>
            </SectionItem>
            <SectionItem icon={null} asChild>
              <div>
                <SectionItemTitle>{t("web.timezone")}</SectionItemTitle>
                <SectionItemValue>{user?.timezone ?? "UTC"}</SectionItemValue>
              </div>
            </SectionItem>
            <SectionItem asChild>
              <Link from={Route.fullPath} to="./feature-flags">
                <SectionItemTitle>Feature Flags</SectionItemTitle>
              </Link>
            </SectionItem>
            <SectionItem
              onClick={() => {
                const url = `http://localhost:3000#tgWebAppData=${encodeURIComponent(
                  window.Telegram?.WebApp.initData ?? ""
                )}`;
                window.open(url);
              }}
            >
              <SectionItemTitle>{t("web.openLocalhost")}</SectionItemTitle>
            </SectionItem>
            <AccountDeleteDialog />
          </SectionItems>
        </Section>
      )}
    </MiniAppPage>
  );
}

function AccountDeleteDialog() {
  const trpc = useTRPC();
  const { mutateAsync: deleteAccount } = useMutation(
    trpc.account.deleteAccount.mutationOptions()
  );
  const { t } = useTranslation();

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <SectionItem className="text-destructive">
          <SectionItemTitle>{t("web.deleteAccount")}</SectionItemTitle>
        </SectionItem>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription>
            <p className="mt-2">{t("web.deleteConfirmDescription")}</p>
            <p className="text-destructive mt-2">
              <strong>{t("web.deleteWarning")}</strong>
            </p>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            onClick={async () => {
              await deleteAccount();
              webApp?.close();
            }}
          >
            {t("web.deleteAccount")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="card" className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

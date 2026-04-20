import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bolt,
  ChevronsUpDownIcon,
  CompassIcon,
  Contact2,
  MessageCircle,
} from "lucide-react";
import { PropsWithChildren, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";

import { HelpButton } from "./help-button";
import { Button } from "./ui/button";
import { WorkspaceSelector } from "./workspace-selector";
import { DesktopSidebar } from "@/components/desktop-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ContactLimitNotification } from "@/features/contacts/contact-limit-notification";
import { useHasFeatureFlag } from "@/hooks/feature-flags";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useSafeArea } from "@/hooks/useSafeArea";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export function MiniAppPage({
  children,
  className,
  workspaceSelector = true,
}: PropsWithChildren<{ workspaceSelector?: boolean; className?: string }>) {
  return (
    <ResponsivePage
      className={className}
      size="narrow"
      workspaceSelector={workspaceSelector}
    >
      {children}
    </ResponsivePage>
  );
}

export function ResponsivePage({
  children,
  containerClassName,
  className,
  size = "responsive",
  workspaceSelector = true,
  helpButton = true,
}: PropsWithChildren<{
  containerClassName?: string;
  className?: string;
  size?: "responsive" | "narrow" | "wide" | "extra-wide";
  workspaceSelector?: boolean;
  helpButton?: boolean;
}>) {
  const { t } = useTranslation();
  const safeArea = useSafeArea();
  const navigateBack = useNavigateBack();
  const location = useRouterState({ select: (s) => s.location });
  const isOutreach = /^\/w\/[^/]+\/(outreach|telegram)/.test(location.pathname);
  const isTools = /^\/w\/[^/]+\/tools/.test(location.pathname);
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const workspaceName = useCurrentWorkspace((s) => s.name);
  const isMobile = useIsMobile();
  const hasConnectedAccounts = useWorkspaceStore(
    (s) => s.telegramAccounts.length > 0
  );
  return (
    <div
      id="container"
      className={cn(
        "@container mx-auto flex min-h-dvh flex-col",
        containerClassName
      )}
      style={{
        borderTop: `${safeArea.top}px solid transparent`,
      }}
    >
      {isMobile && (
        <header
          className={cn(
            "@desktop:hidden flex items-center justify-between px-3 py-1"
          )}
        >
          <div className="bg-muted text-muted-foreground flex rounded-lg p-0.5 text-sm font-medium">
            <Link
              to="/"
              className={cn(
                "flex items-center gap-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 transition-colors",
                !isOutreach &&
                  !isTools &&
                  "bg-card text-card-foreground dark:bg-background dark:text-foreground shadow-sm"
              )}
            >
              <Contact2 className="size-3" />
              <span>{t("web.crm")}</span>
            </Link>
            {hasConnectedAccounts ? (
              <Link
                to="/w/$workspaceId/telegram"
                params={{ workspaceId }}
                className={cn(
                  "flex items-center gap-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 transition-colors",
                  isOutreach &&
                    "bg-card text-card-foreground dark:bg-background dark:text-foreground shadow-sm"
                )}
              >
                <MessageCircle className="size-3" />
                <span>{t("web.outreachLabel")}</span>
              </Link>
            ) : (
              <Link
                to="/w/$workspaceId/outreach/telegram-accounts"
                params={{ workspaceId }}
                className={cn(
                  "flex items-center gap-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 transition-colors",
                  isOutreach &&
                    "bg-card text-card-foreground dark:bg-background dark:text-foreground shadow-sm"
                )}
              >
                <MessageCircle className="size-3" />
                <span>{t("web.outreachLabel")}</span>
              </Link>
            )}
            <Link
              to="/w/$workspaceId/tools/phone-numbers-converter"
              params={{ workspaceId }}
              className={cn(
                "flex items-center gap-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 transition-colors",
                isTools &&
                  "bg-card text-card-foreground dark:bg-background dark:text-foreground shadow-sm"
              )}
            >
              <CompassIcon className="size-4" />
              <span className="sr-only">{t("web.toolsLabel")}</span>
            </Link>
          </div>
          <div className="ml-auto">
            <WorkspaceSelector>
              <Button
                variant="ghost"
                size="sm"
                className="group flex min-w-0 shrink items-center gap-1 text-sm font-medium"
                disabled={!workspaceSelector}
              >
                <div className="overflow-hidden overflow-ellipsis">
                  {workspaceName}
                </div>
                <ChevronsUpDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </WorkspaceSelector>
          </div>
          <Button variant="ghost" size="icon" title="Settings" asChild>
            <Link
              to="/w/$workspaceId/settings"
              params={{ workspaceId }}
              className="relative"
            >
              <Bolt className="size-4" />
              <span className="sr-only">{t("web.settings")}</span>
              <span className="bg-primary absolute right-1 top-1 h-2 w-2 rounded-full" />
            </Link>
          </Button>
        </header>
      )}
      <SidebarProvider persistenceKey="nav-sidebar">
        <DesktopSidebar workspaceSelector={workspaceSelector} />
        <main
          className={cn("flex grow flex-col", helpButton && "!pb-20")}
          style={{ width: "calc(100vw - var(--sidebar-width))" }}
          id="container-content"
        >
          <ContactLimitNotification className="mx-3" />
          <div className="relative flex min-h-0 grow">
            <div
              className={cn(
                "@desktop:py-2 @desktop:border @desktop:border-transparent relative mx-auto box-border w-full px-3 py-2",
                size === "narrow" ? "max-w-md" : "w-full",
                size !== "narrow" &&
                  size !== "extra-wide" &&
                  "@desktop:px-16 px-0",
                className
              )}
            >
              <Suspense>{children}</Suspense>
            </div>
            {size !== "extra-wide" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  navigateBack({
                    fallback: {
                      to: "/w/$workspaceId/contacts",
                      params: { workspaceId },
                      replace: true,
                    },
                  })
                }
                className="@desktop:flex text-muted-foreground/70 hover:text-foreground absolute left-4 top-4 hidden transition-colors"
              >
                <ArrowLeft className="size-5" />
              </Button>
            )}
            <DevToolsButton />
          </div>
        </main>
      </SidebarProvider>
      {helpButton && <HelpButton />}
    </div>
  );
}

const Devtools = lazy(() =>
  import("./devtools").then((m) => ({ default: m.Devtools }))
);

function DevToolsButton() {
  const hasFeatureFlag = useHasFeatureFlag("devtools");
  if (import.meta.env.DEV || hasFeatureFlag) {
    return <Devtools />;
  }
  return null;
}

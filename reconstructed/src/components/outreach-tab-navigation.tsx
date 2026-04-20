import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Tab, TabList } from "./ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrentWorkspace } from "@/lib/store";

export function OutreachTabNavigation() {
  const { t } = useTranslation();
  const location = useRouterState({ select: (s) => s.location });
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <TabList className="@desktop:hidden block h-fit">
      <Tab active={/^\/w\/[^/]+\/telegram$/.test(location.pathname)} asChild>
        <Link to="/w/$workspaceId/telegram" params={{ workspaceId }}>
          {t("web.chatLabel")}
        </Link>
      </Tab>
      <Tab
        asChild
        active={
          /^\/w\/[^/]+\/outreach/.test(location.pathname) &&
          !location.pathname.endsWith("/group-parser") &&
          !location.pathname.includes("/telegram-accounts") &&
          !location.pathname.endsWith("/ai-bot")
        }
      >
        <Link to="/w/$workspaceId/outreach" params={{ workspaceId }}>
          {t("web.sequences")}
        </Link>
      </Tab>
      <Tab
        asChild
        active={/^\/w\/[^/]+\/outreach\/telegram-accounts/.test(
          location.pathname
        )}
      >
        <Link
          to="/w/$workspaceId/outreach/telegram-accounts"
          params={{ workspaceId }}
        >
          {t("web.telegramAccountsShort")}
        </Link>
      </Tab>
      <Tab
        asChild
        active={/^\/w\/[^/]+\/outreach\/ai-bot/.test(location.pathname)}
      >
        <Link to="/w/$workspaceId/outreach/ai-bot" params={{ workspaceId }}>
          {t("web.aiBotShort")}
        </Link>
      </Tab>
    </TabList>
  );
}

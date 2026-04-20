import { Link, useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tab, TabList } from "./ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrentWorkspace } from "@/lib/store";

export function ToolsTabNavigation() {
  const { t } = useTranslation();
  const location = useRouterState({ select: (s) => s.location });
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const isMobile = useIsMobile();
  if (!isMobile) return null;
  return (
    <TabList className="@desktop:hidden block h-fit">
      {/* Temporarily hidden - may bring back in the future */}
      {/* <Tab
        asChild
        active={/^\/w\/[^/]+\/tools\/lookalike-audience/.test(
          location.pathname
        )}
      >
        <Link
          to="/w/$workspaceId/tools/lookalike-audience"
          params={{ workspaceId }}
        >
          {t("web.lookalikeAudiences")}
        </Link>
      </Tab> */}
      <Tab
        asChild
        active={/^\/w\/[^/]+\/tools\/phone-numbers-converter/.test(
          location.pathname
        )}
      >
        <Link
          to="/w/$workspaceId/tools/phone-numbers-converter"
          params={{ workspaceId }}
        >
          {t("web.phoneNumbersConverter")}
        </Link>
      </Tab>
      <Tab
        asChild
        active={/^\/w\/[^/]+\/tools\/group-parser/.test(location.pathname)}
      >
        <Link to="/w/$workspaceId/tools/group-parser" params={{ workspaceId }}>
          {t("web.groupParser")}
        </Link>
      </Tab>
      <Tab asChild active={false}>
        <a
          className="flex items-center gap-1.5"
          href="https://crmchat.ai/web3-database"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("web.web3Database")}
          <ExternalLinkIcon className="size-3" />
        </a>
      </Tab>
      <Tab asChild active={false}>
        <a
          className="flex items-center gap-1.5"
          href="https://t.me/crmchatchannelbot"
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("web.channelSync", "Channel Sync")}
          <ExternalLinkIcon className="size-3" />
        </a>
      </Tab>
    </TabList>
  );
}

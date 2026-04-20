"use client";

import { Link, LinkProps } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  ChevronsRightIcon,
  ChevronsUpDownIcon,
  CogIcon,
  CompassIcon,
  Contact2Icon,
  ExternalLinkIcon,
  GiftIcon,
  HelpCircleIcon,
  MessageCircleIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  UsersIcon,
  ZapIcon,
} from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import crmchatLogo from "@/assets/crmchat.jpeg";
import TelegramLogo from "@/assets/telegram-logo.svg";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { WorkspaceSelector } from "@/components/workspace-selector";
import { useCelloTrigger } from "@/features/cello/cello-trigger";
import { useTheme } from "@/hooks/useTheme";
import { useActiveSubscription, useCurrentWorkspace } from "@/lib/store";
import { webApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";

type NavSubItem = { title: string } & (
  | { link: LinkProps }
  | { externalHref: string }
);

type NavItem = {
  title: string;
  link?: LinkProps;
  icon?: React.ElementType;
  isActive?: boolean;
  isNew?: boolean;
  items?: NavSubItem[];
};

function ExpandButton() {
  const { t } = useTranslation();
  const { state, toggleSidebar } = useSidebar();

  if (state !== "collapsed") {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t("web.expandSidebar", "Expand sidebar")}
          onClick={toggleSidebar}
          className="group-data-[collapsible=icon]:!p-1.5"
        >
          <ChevronsRightIcon className="text-muted-foreground !size-5" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function renderSubItemLink(subItem: NavSubItem) {
  if ("externalHref" in subItem) {
    return (
      <a href={subItem.externalHref} target="_blank" rel="noopener noreferrer">
        <span>{subItem.title}</span>
        <ExternalLinkIcon className="!text-muted-foreground size-3" />
      </a>
    );
  }
  return (
    <Link {...subItem.link}>
      <span>{subItem.title}</span>
    </Link>
  );
}

function NavItems({ items }: { items: NavItem[] }) {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <SidebarMenu>
      {items.map((item) => {
        if (!item.items) {
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild tooltip={item.title}>
                <Link {...item.link}>
                  {item.icon && <item.icon className="text-muted-foreground" />}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        }

        if (collapsed) {
          return (
            <SidebarMenuItem key={item.title}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon && (
                      <item.icon className="text-muted-foreground" />
                    )}
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuLabel>{item.title}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {item.items.map((subItem) => (
                      <DropdownMenuItem key={subItem.title} asChild>
                        {renderSubItemLink(subItem)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          );
        }

        return (
          <Collapsible
            key={item.title}
            asChild
            defaultOpen={item.isActive}
            className="group/collapsible"
          >
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && (
                    <item.icon className="text-muted-foreground size-4" />
                  )}
                  <span>{item.title}</span>
                  {item.isNew && (
                    <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-xs">
                      {t("web.new", "New")}
                    </span>
                  )}
                  <ChevronRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton asChild>
                        {renderSubItemLink(subItem)}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        );
      })}
    </SidebarMenu>
  );
}

export function DesktopSidebar({
  workspaceSelector,
  ...props
}: React.ComponentProps<typeof Sidebar> & { workspaceSelector: boolean }) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const workspaceName = useCurrentWorkspace((s) => s.name);
  const activeSubscriptionPlan = useActiveSubscription((s) => s.plan);

  const data = {
    navMain: [
      {
        title: t("web.leads", "Leads"),
        icon: Contact2Icon,
        isActive: true,
        items: [
          {
            title: t("web.list", "List"),
            link: { to: "/w/$workspaceId/contacts", params: { workspaceId } },
          },
          {
            title: t("web.pipeline", "Pipeline"),
            link: {
              to: "/w/$workspaceId/contacts",
              params: { workspaceId },
              search: { view: "pipeline" },
            },
          },
          {
            title: t("web.customProperties", "Custom Properties"),
            link: {
              to: "/w/$workspaceId/settings/properties/$objectType",
              params: { workspaceId, objectType: "contacts" },
            },
          },
          {
            title: t("web.telegramFolderSync", "Telegram Folder Sync"),
            link: {
              to: "/w/$workspaceId/settings/telegram-sync",
              params: { workspaceId },
            },
          },
        ],
      },
      {
        title: t("web.outreachLabel", "Outreach"),
        icon: MessageCircleIcon,
        isActive: true,
        items: [
          {
            title: t("web.chatLabel", "Chat"),
            link: { to: "/w/$workspaceId/telegram", params: { workspaceId } },
          },
          {
            title: t("web.sequences", "Sequences"),
            link: { to: "/w/$workspaceId/outreach", params: { workspaceId } },
          },
          {
            title: t("web.telegramAccounts", "Telegram Accounts"),
            link: {
              to: "/w/$workspaceId/outreach/telegram-accounts",
              params: { workspaceId },
            },
          },
          {
            title: t("web.aiBotShort", "AI Bot"),
            link: {
              to: "/w/$workspaceId/outreach/ai-bot",
              params: { workspaceId },
            },
          },
        ],
      },
      {
        title: t("web.toolsLabel"),
        icon: CompassIcon,
        isActive: true,
        isNew: false,
        items: [
          // Temporarily hidden - may bring back in the future
          // {
          //   title: t("web.lookalikeAudiences"),
          //   link: {
          //     to: "/w/$workspaceId/tools/lookalike-audience",
          //     params: { workspaceId },
          //   },
          // },
          {
            title: t("web.phoneNumbersConverter"),
            link: {
              to: "/w/$workspaceId/tools/phone-numbers-converter",
              params: { workspaceId },
            },
          },
          {
            title: t("web.groupParser"),
            link: {
              to: "/w/$workspaceId/tools/group-parser",
              params: { workspaceId },
            },
          },
          {
            title: t("web.web3Database"),
            externalHref: "https://crmchat.ai/web3-database",
          },
          {
            title: t("web.channelSync", "Channel Sync"),
            externalHref: "https://t.me/crmchatchannelbot",
          },
        ],
      },
      {
        title: t("web.teamMembers", "Team"),
        link: {
          to: "/w/$workspaceId/settings/workspace",
          params: { workspaceId },
        },
        icon: UsersIcon,
      },
      {
        title: t("web.integrations", "Integrations"),
        icon: ZapIcon,
        items: [
          {
            title: "API",
            link: {
              to: "/w/$workspaceId/settings/api-keys",
              params: { workspaceId },
            },
          },
          {
            title: t("web.googleCalendar", "Google Calendar"),
            link: {
              to: "/w/$workspaceId/settings/google-calendar",
              params: { workspaceId },
            },
          },
          {
            title: t("web.zapier", "Zapier"),
            link: {
              to: "/w/$workspaceId/settings/connect-crm",
              params: { workspaceId },
            },
          },
        ],
      },
    ] satisfies NavItem[],
  };

  const { celloClassName, rewardCap } = useCelloTrigger();

  return (
    <Sidebar
      collapsible="icon"
      {...props}
      className="@desktop:block hidden"
      variant="floating"
    >
      <SidebarHeader>
        <WorkspaceSelector>
          <SidebarMenuButton
            disabled={!workspaceSelector}
            size="lg"
            tooltip={{
              children: (
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {t("web.workspaceLabel", "Workspace")}
                  </span>
                  <span>{workspaceName}</span>
                </div>
              ),
            }}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <img
                src={crmchatLogo}
                alt="workspace logo"
                className="border-border size-8 min-w-6 rounded-lg border"
              />
            </div>
            <div className="flex flex-col gap-1 leading-none">
              <span className="whitespace-nowrap font-semibold">
                {workspaceName}
              </span>
              <span className="text-muted-foreground whitespace-nowrap capitalize">
                {activeSubscriptionPlan
                  ? t("text.subscription.plan", {
                      context: activeSubscriptionPlan,
                    })
                  : t("web.workspaceSelector.freePlan")}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto" />
          </SidebarMenuButton>
        </WorkspaceSelector>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <NavItems items={data.navMain} />
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <ExpandButton />
        {!webApp && (
          <SidebarMenuItem className="list-none">
            <SidebarMenuButton asChild tooltip={t("web.openTelegramApp")}>
              <a
                href={`tg://resolve?domain=${import.meta.env.VITE_BOT_USERNAME}`}
                target="_blank"
              >
                <img
                  src={TelegramLogo}
                  alt="Telegram"
                  className="text-muted-foreground size-4"
                />
                <span>{t("web.openTelegramApp")}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem className="list-none">
          <SidebarMenuButton asChild tooltip={t("web.help.title", "Help")}>
            <Link to="/w/$workspaceId/settings/help" params={{ workspaceId }}>
              <HelpCircleIcon className="text-muted-foreground size-4" />
              <span>{t("web.help.title", "Help")}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className={cn("list-none", celloClassName)}>
          <SidebarMenuButton
            tooltip={t("web.affiliateProgram.title", "Affiliate")}
          >
            <GiftIcon className="text-muted-foreground size-4" />
            <span>
              {t("web.affiliateProgram.earn", {
                value: rewardCap ?? 0,
                formatParams: {
                  value: { currency: "USD", maximumFractionDigits: 0 },
                },
              })}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <div className="flex items-center gap-2">
          <SidebarMenuItem className="grow list-none">
            <SidebarMenuButton asChild tooltip={t("web.settings", "Settings")}>
              <Link to="/w/$workspaceId/settings" params={{ workspaceId }}>
                <CogIcon className="text-muted-foreground size-4" />
                <span>{t("web.settings", "Settings")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="list-none">
            <ThemeToggle />
          </SidebarMenuItem>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
function ThemeToggle() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const { setTheme } = useTheme();

  if (webApp || state === "collapsed") {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton className="relative">
          <SunIcon className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t("web.themeSwitcher.title")}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <SunIcon className="size-4" />
          {t("web.themeSwitcher.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <MoonIcon className="size-4" />
          {t("web.themeSwitcher.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <MonitorIcon className="size-4" />
          {t("web.themeSwitcher.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

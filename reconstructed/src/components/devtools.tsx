import { Link } from "@tanstack/react-router";
import { CodeXmlIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useSidebar } from "./ui/sidebar";
import { useTheme } from "@/hooks/useTheme";
import { useUser } from "@/hooks/useUser";
import { useCurrentOrganization, useCurrentWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";

export function Devtools() {
  const user = useUser();

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const organizationId = useCurrentOrganization((s) => s.id);

  const sidebar = useSidebar();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          title="Devtools"
          className={cn(
            "fixed left-5 z-50 size-10 rounded-full shadow-[0_0_3px_rgb(0_0_0/0.15)] transition-transform",
            sidebar.state === "collapsed"
              ? "@desktop:left-[calc(var(--sidebar-width-icon)+1.5rem)]"
              : "@desktop:left-[calc(var(--sidebar-width)+0.5rem)]"
          )}
          style={{
            bottom: `calc(100vh - var(--tg-viewport-stable-height, 100vh) + 1.25rem)`,
          }}
        >
          <CodeXmlIcon className="!size-5" />
          <span className="sr-only">Devtools</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={12}
        className="w-[22rem]"
      >
        <ThemeSwitcher />
        <LanguageSwitcher />

        <DevItem>
          <DevItemTitle>User ID</DevItemTitle>
          <DevItemValue>{user?.id ?? "-"}</DevItemValue>
        </DevItem>
        <DevItem>
          <DevItemTitle>Workspace ID</DevItemTitle>
          <DevItemValue>{workspaceId}</DevItemValue>
        </DevItem>
        <DevItem>
          <DevItemTitle>Organization ID</DevItemTitle>
          <DevItemValue>{organizationId}</DevItemValue>
        </DevItem>
        <DevItem>
          <DevItemTitle>Feature Flags</DevItemTitle>
          <DevItemValue>
            <Link
              to="/w/$workspaceId/settings/feature-flags"
              params={{ workspaceId }}
              className="text-primary hover:underline"
            >
              View Feature Flags
            </Link>
          </DevItemValue>
        </DevItem>
      </PopoverContent>
    </Popover>
  );
}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <DevItem>
      <DevItemTitle>Theme</DevItemTitle>
      <ButtonGroup>
        <Button
          variant={theme === "system" ? "default" : "outline"}
          size="icon"
          className="size-8"
          onClick={() => setTheme("system")}
        >
          <MonitorIcon />
        </Button>
        <Button
          variant={theme === "light" ? "default" : "outline"}
          size="icon"
          className="size-8"
          onClick={() => setTheme("light")}
        >
          <SunIcon />
        </Button>
        <Button
          variant={theme === "dark" ? "default" : "outline"}
          size="icon"
          className="size-8"
          onClick={() => setTheme("dark")}
        >
          <MoonIcon />
        </Button>
      </ButtonGroup>
    </DevItem>
  );
}

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  return (
    <DevItem>
      <DevItemTitle>Language</DevItemTitle>
      <ButtonGroup>
        <Button
          variant={i18n.language === "en" ? "default" : "outline"}
          onClick={() => i18n.changeLanguage("en")}
          size="xs"
        >
          en
        </Button>
        <Button
          variant={i18n.language === "ru" ? "default" : "outline"}
          onClick={() => i18n.changeLanguage("ru")}
          size="xs"
        >
          ru
        </Button>
      </ButtonGroup>
    </DevItem>
  );
}

function DevItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      {children}
    </div>
  );
}

function DevItemTitle({ children }: { children: React.ReactNode }) {
  return <span className="text-sm font-medium">{children}</span>;
}

function DevItemValue({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-sm">{children}</span>;
}

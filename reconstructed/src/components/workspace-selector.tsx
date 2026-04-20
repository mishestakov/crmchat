"use client";

import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  EllipsisIcon,
  MessageCircleOffIcon,
  Plus,
  SlidersHorizontal,
  UserPlus,
} from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { OrganizationWithId } from "@repo/core/types";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tip } from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getOrganizationName } from "@/lib/organization";
import { useCurrentWorkspace } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";

export function WorkspaceSelector({
  children,
}: {
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();

  const match = useRouterState({ select: (s) => s.matches.at(-1) });
  const navigate = useNavigate();
  const organizations = useWorkspacesStore((s) => s.organizations);
  const workspaceId = useCurrentWorkspace((s) => s.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuRadioGroup
          value={workspaceId}
          onValueChange={(v) => {
            if (!match) return;

            // change workspace id in the current route and keep every other param the same
            navigate({
              from: match.fullPath,
              params: (prev) => ({ ...prev, workspaceId: v }),
              search: (prev) => prev,
            });
          }}
        >
          {organizations.map((organization, index) => (
            <Fragment key={organization.id}>
              {index > 0 && <DropdownMenuSeparator />}
              <OrganizationItem organization={organization} />
            </Fragment>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            to="/w/$workspaceId/settings/workspace"
            params={{ workspaceId }}
          >
            <UserPlus />
            <span>{t("web.inviteTeam")}</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrganizationItem({
  organization,
}: {
  organization: OrganizationWithId;
}) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const workspaces = useWorkspacesStore(
    (s) => s.workspacesByOrganizationId[organization.id]
  );
  if (!workspaces || workspaces.length === 0) {
    return null;
  }

  return (
    <Fragment>
      <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2 text-xs">
        {getOrganizationName(organization)}
        <i className="ml-auto pl-2" />
        {organization.subscription?.active && (
          <Link
            to="/w/$workspaceId/settings/subscription"
            params={{ workspaceId }}
            search={{ organizationId: organization.id }}
          >
            <Badge variant="green" shape="inline">
              {t(
                `text.subscription.plan_${organization.subscription.plan ?? "pro"}`
              )}
            </Badge>
          </Link>
        )}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="size-5 p-0">
              <EllipsisIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="text-sm" side="right">
            <DropdownMenuItem asChild>
              <Link
                to="/w/$workspaceId/settings/organization/$organizationId"
                params={{ workspaceId, organizationId: organization.id }}
              >
                <SlidersHorizontal />
                <span>{t("web.workspaceSelector.editOrganizationName")}</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                to="/w/$workspaceId/settings/workspace/new"
                params={{ workspaceId }}
                search={{ organizationId: organization.id }}
              >
                <Plus />
                <span>{t("web.workspaceSelector.newWorkspace")}</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </DropdownMenuLabel>
      {workspaces?.map((w) => (
        <DropdownMenuRadioItem key={w.id} value={w.id}>
          {w.name}
          {w.excludeFromAccountBilling && (
            <Tip
              content={t("web.workspaceSelector.excludedFromAccountBilling")}
              className="ml-auto"
            >
              <MessageCircleOffIcon className="text-muted-foreground size-3.5" />
            </Tip>
          )}
        </DropdownMenuRadioItem>
      ))}
    </Fragment>
  );
}

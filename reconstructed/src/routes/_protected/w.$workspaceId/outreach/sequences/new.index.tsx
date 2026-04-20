import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  FileInputIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { useCanUseSequences } from "@/hooks/subscription";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/new/"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const canCreateOutreachSequence = useCanUseSequences();
  if (!canCreateOutreachSequence) {
    return (
      <Navigate
        from={Route.fullPath}
        to="../../../settings/subscription"
        search={{ minPlan: "team" }}
        replace
      />
    );
  }
  return (
    <MiniAppPage className="flex flex-col gap-2">
      <OutreachTabNavigation />
      <div className="flex flex-col gap-3">
        <Item
          variant="card"
          size="sm"
          className="hover:bg-card/70 group"
          asChild
        >
          <Link from={Route.fullPath} to="csv">
            <ItemMedia variant="primaryIcon">
              <FileInputIcon className="text-muted-foreground group-hover:text-foreground transition-colors" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t("web.outreach.list.index.csvTitle")}</ItemTitle>
              <ItemDescription>
                {t("web.outreach.list.index.csvDescription")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4" />
            </ItemActions>
          </Link>
        </Item>
        <Item
          variant="card"
          size="sm"
          className="hover:bg-card/70 group"
          asChild
        >
          <Link
            from={Route.fullPath}
            to="crm"
            search={{ contactType: "contact" }}
          >
            <ItemMedia variant="primaryIcon">
              <UserRoundIcon className="text-muted-foreground group-hover:text-foreground transition-colors" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {t("web.outreach.list.crm.leadsFromCrmTitle")}
              </ItemTitle>
              <ItemDescription>
                {t("web.outreach.list.crm.leadsFromCrmDescription")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4" />
            </ItemActions>
          </Link>
        </Item>
        <Item
          variant="card"
          size="sm"
          className="hover:bg-card/70 group"
          asChild
        >
          <Link
            from={Route.fullPath}
            to="crm"
            search={{ contactType: "group" }}
          >
            <ItemMedia variant="primaryIcon">
              <UsersRoundIcon className="text-muted-foreground group-hover:text-foreground transition-colors" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                {t("web.outreach.list.groups.groupsFromCrmTitle")}
              </ItemTitle>
              <ItemDescription>
                {t("web.outreach.list.groups.groupsFromCrmDescription")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4" />
            </ItemActions>
          </Link>
        </Item>
      </div>
    </MiniAppPage>
  );
}

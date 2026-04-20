import { Link, createFileRoute } from "@tanstack/react-router";
import { Plus, TriangleAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { OutreachSequence } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { Badge } from "@/components/ui/badge";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useWorkspaceStore } from "@/lib/store";

function getStatusBadgeVariant(status: OutreachSequence["status"]) {
  switch (status) {
    case "active":
      return "blue";
    case "paused":
      return "yellow";
    case "completed":
      return "green";
    default:
      return "outline";
  }
}

export const Route = createFileRoute("/_protected/w/$workspaceId/outreach/")({
  component: RouteComponent,
});

function RouteComponent() {
  const accountCount = useWorkspaceStore((s) => s.telegramAccounts.length);
  const { t } = useTranslation();
  return (
    <MiniAppPage className="flex flex-col gap-4">
      <OutreachTabNavigation />
      <Section>
        <SectionItems>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./telegram-accounts">
              <SectionItemTitle>
                {t("web.outreach.index.accountsTitle")}
              </SectionItemTitle>
              {accountCount > 0 && (
                <SectionItemValue>{accountCount}</SectionItemValue>
              )}
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./schedule">
              <SectionItemTitle>
                {t("web.outreach.index.scheduleTitle")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>
      <SequencesSection />
    </MiniAppPage>
  );
}

function SequencesSection() {
  const sequences = useWorkspaceStore((s) => s.outreachSequences);
  const { t } = useTranslation();

  return (
    <Section>
      <SectionHeader>{t("web.sequences")}</SectionHeader>
      <SectionItems>
        {sequences.map((sequence) => (
          <SectionItem asChild key={sequence.id}>
            <Link
              from={Route.fullPath}
              to="./sequences/$id"
              params={{ id: sequence.id }}
            >
              <SectionItemTitle>{sequence.name}</SectionItemTitle>
              <SectionItemValue>
                {sequence.duplicationResolutionNeeded && (
                  <TriangleAlertIcon className="size-4 text-yellow-500" />
                )}
                <Badge
                  className="whitespace-nowrap text-xs"
                  variant={getStatusBadgeVariant(sequence.status)}
                >
                  {t(`web.outreach.sequences.status.${sequence.status}`)}
                </Badge>
              </SectionItemValue>
            </Link>
          </SectionItem>
        ))}

        <SectionItem asChild className="text-muted-foreground">
          <Link from={Route.fullPath} to="./sequences/new">
            <Plus className="size-4" />
            <SectionItemTitle>
              {t("web.outreach.index.newSequenceButton")}
            </SectionItemTitle>
          </Link>
        </SectionItem>
      </SectionItems>
    </Section>
  );
}

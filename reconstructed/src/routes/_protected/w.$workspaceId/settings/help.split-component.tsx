import { Link, createFileRoute } from "@tanstack/react-router";
import {
  BookOpenTextIcon,
  ExternalLink,
  MessageCircle,
  PlayCircle,
  Sparkle,
  Users,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { useCurrentWorkspace } from "@/lib/store";
import { webApp } from "@/lib/telegram";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/help"
)({
  component: HelpPage,
});

function HelpPage() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  return (
    <MiniAppPage className="flex flex-col gap-5 pb-6">
      <Section>
        <SectionHeader>{t("web.help.title")}</SectionHeader>
        <SectionItems>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href={t("web.help.knowledgeBaseUrl")}
              target="_blank"
              rel="noopener noreferrer"
            >
              <BookOpenTextIcon className="size-4 text-yellow-600" />
              <SectionItemTitle>{t("web.help.knowledgeBase")}</SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href="https://www.youtube.com/playlist?list=PLORsUW6HpEKDiaJhAo48w07ZhmA64m9eJ"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PlayCircle className="size-4 text-blue-600 dark:text-blue-500" />
              <SectionItemTitle>
                {t("web.help.crmVideoGuides")}
              </SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a
              href="https://www.youtube.com/playlist?list=PLORsUW6HpEKDINzXYHANHtqkb_n6gBHtB"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PlayCircle className="size-4 text-rose-600 dark:text-rose-500" />
              <SectionItemTitle>
                {t("web.help.outreachVideoGuides")}
              </SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild icon={ExternalLink}>
            <a href="https://t.me/Hints_CRM_community" target="_blank">
              <Users className="size-4 text-green-600" />
              <SectionItemTitle>{t("web.joinCommunityChat")}</SectionItemTitle>
            </a>
          </SectionItem>
          <SectionItem asChild>
            <Link to="/w/$workspaceId/onboarding" params={{ workspaceId }}>
              <Sparkle className="size-4 text-purple-600" />
              <SectionItemTitle>
                {t("web.help.viewOnboarding")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionHeader>{t("web.help.supportTitle")}</SectionHeader>
        <Card className="border-none shadow-none">
          <CardContent className="space-y-3 p-4">
            <p className="text-center">{t("web.help.needHelp")}</p>
            <Button className="w-full" variant="secondary" asChild>
              <a
                href="https://t.me/HintsSupportBot"
                target="_blank"
                onClick={(e) => {
                  e.preventDefault();
                  if (webApp) {
                    webApp.openLink(e.currentTarget.href);
                  } else {
                    window.open(e.currentTarget.href, "_blank");
                  }
                }}
              >
                <MessageCircle className="size-5" />
                <span>
                  <Trans
                    t={t}
                    i18nKey="web.help.chatWithUs"
                    components={{ 1: <span className="text-primary" /> }}
                  />
                </span>
              </a>
            </Button>
          </CardContent>
        </Card>
      </Section>
    </MiniAppPage>
  );
}

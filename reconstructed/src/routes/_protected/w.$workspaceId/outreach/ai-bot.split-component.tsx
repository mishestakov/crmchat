import { createFileRoute } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import telegramIcon from "@/assets/telegram-logo.svg";
import { MiniAppPage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AI_BOT_PRICE_USD, getCachedApiUrlOrFallback } from "@/config";
import { useIdToken } from "@/hooks/useIdToken";
import { useCurrentWorkspace } from "@/lib/store";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/ai-bot"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  const idToken = useIdToken();
  const workspaceId = useCurrentWorkspace((state) => state.id);

  return (
    <MiniAppPage className="flex flex-col gap-4">
      <OutreachTabNavigation />
      <Card>
        <CardHeader className="items-center gap-3">
          <img src={telegramIcon} className="size-16" />

          <CardTitle className="flex items-center gap-1 text-center text-lg">
            <BotIcon className="text-muted-foreground size-5" />
            {t("web.outreach.aiBot.title")}
          </CardTitle>
          <CardDescription className="text-foreground px-3">
            {t("web.outreach.aiBot.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="bg-secondary rounded-lg p-3 text-sm">
            <p className="text-xs font-semibold opacity-95">
              {t("web.outreach.aiBot.whatsIncluded")}
            </p>
            <p className="mt-1">
              {t("web.outreach.aiBot.whatsIncludedDescription")}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button className="w-full" asChild>
            <a
              href={`${getCachedApiUrlOrFallback()}/stripe/buy?idToken=${encodeURIComponent(idToken ?? "")}&workspaceId=${workspaceId ?? ""}&product=ai-bot&quantity=1`}
            >
              {t("web.outreach.aiBot.buyButton", {
                price: AI_BOT_PRICE_USD,
              })}
            </a>
          </Button>
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, Gift, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyableInput } from "@/components/ui/copiable-input";
import { webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/affiliate"
)({
  component: AffiliateSettings,
});

function AffiliateSettings() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { data } = useQuery(
    trpc.account.getAffiliateInfo.queryOptions(
      { prepareShareMessage: true },
      { staleTime: Infinity }
    )
  );

  const personalLink = `https://t.me/${import.meta.env.VITE_BOT_USERNAME}?start=ref_${data?.promoCode ?? ""}`;

  return (
    <MiniAppPage>
      <Card>
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            {t("web.affiliate.title")}
          </CardTitle>
          <CardDescription>{t("web.affiliate.description")}</CardDescription>
        </CardHeader>
        <CardContent className="mt-2 space-y-5">
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <Gift className="h-5 w-5 text-purple-500" />
              {t("web.affiliate.friendsGetTitle")}
            </h3>
            <p className="text-muted-foreground pl-7 text-sm">
              {t("web.affiliate.friendsGetDesc")}
            </p>
          </div>
          <div className="space-y-2">
            <h3 className="flex items-center gap-2 font-semibold">
              <DollarSign className="h-5 w-5 text-green-500" />
              {t("web.affiliate.youEarnTitle")}
            </h3>
            <p className="text-muted-foreground pl-7 text-sm">
              {t("web.affiliate.youEarnDesc")}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 px-4">
          <div className="w-full space-y-2">
            <label
              htmlFor="link"
              className="text-muted-foreground mx-3 text-sm font-medium"
            >
              {t("web.affiliate.personalLinkLabel")}
            </label>
            <CopyableInput
              id="link"
              value={personalLink}
              className="w-full px-1"
              inputClassName="text-sm"
            />
          </div>
          {webApp && (
            <Button
              className="w-full bg-purple-600 text-white hover:bg-purple-700"
              onClick={() => {
                if (data?.shareMessageId) {
                  webApp?.shareMessage(data.shareMessageId);
                }
              }}
            >
              <Share2 className="size-4" />
              {t("web.affiliate.shareButton")}
            </Button>
          )}
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import googleSheetsIcon from "@/assets/google-sheets-logo.svg";
import hubspotIcon from "@/assets/hubspot-logo.svg";
import notionIcon from "@/assets/notion-logo.svg";
import pipedriveIcon from "@/assets/pipedrive-logo.svg";
import salesforceIcon from "@/assets/salesforce-logo.svg";
import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyableInput } from "@/components/ui/copiable-input";
import { ZAPIER_INVITE_URL } from "@/config";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/connect-crm"
)({
  component: ConnectCrm,
});

function ConnectCrm() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((w) => w.id);
  const trpc = useTRPC();
  const { data: account } = useQuery(
    trpc.zapier.status.queryOptions(
      { workspaceId },
      { refetchOnWindowFocus: true }
    )
  );
  return (
    <MiniAppPage className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-col items-center">
          <div className="mb-6 mt-4 flex items-center space-x-6">
            <img
              className="size-8"
              src={googleSheetsIcon}
              alt="Google Sheets"
            />
            <img
              className="size-10"
              src={salesforceIcon}
              alt="Salesforce logo"
            />
            <img className="size-12" src={pipedriveIcon} alt="Pipedrive logo" />
            <img className="size-10" src={hubspotIcon} alt="HubSpot logo" />
            <img className="size-8" src={notionIcon} alt="Notion" />
          </div>
          <CardTitle>{t("web.connectCrm.title")}</CardTitle>
        </CardHeader>

        <CardContent className="px-8 text-center text-sm">
          <p>{t("web.connectCrm.setupHelp")}</p>
          <p>{t("web.connectCrm.setupZapier")}</p>
        </CardContent>
        <CardFooter className="flex flex-col space-y-2 text-sm">
          <Button asChild className="w-full">
            <a href={ZAPIER_INVITE_URL}>
              {t("web.connectCrm.setupZapierButton")}
            </a>
          </Button>
          <Button asChild className="w-full" variant="secondary">
            <a href="https://t.me/HintsSupportBot">
              {t("web.connectCrm.contactUsButton")}
            </a>
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardContent className="py-5 pt-3">
          <h3 className="text-muted-foreground mx-3 mb-1 mt-2 text-xs uppercase">
            {t("web.zapierIntegration.apiKeyLabel")}
          </h3>
          <CopyableInput value={account?.apiKey ?? ""} />
          <p className="text-muted-foreground mx-3 mt-1 text-xs">
            {t("web.zapierIntegration.apiKeyDescription")}
          </p>
        </CardContent>
      </Card>
    </MiniAppPage>
  );
}

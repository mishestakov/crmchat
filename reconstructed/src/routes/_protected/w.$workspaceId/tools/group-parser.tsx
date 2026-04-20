import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import telegramIcon from "@/assets/telegram-logo.svg";
import { MiniAppPage } from "@/components/mini-app-page";
import { ToolsTabNavigation } from "@/components/tools-tab-navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WalletBalance } from "@/features/wallet/wallet-balance";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/tools/group-parser"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const { mutateAsync: createGroupParseRequest, isPending } = useMutation(
    trpc.outreach.tools.createGroupParseRequest.mutationOptions({
      onError: (error) => {
        toast.error(t("web.common.error.somethingWentWrong"), {
          description: error.message,
        });
      },
    })
  );
  return (
    <MiniAppPage className="flex flex-col gap-4">
      <ToolsTabNavigation />
      <WalletBalance />
      <Card>
        <CardHeader className="flex flex-col items-center gap-2">
          <img src={telegramIcon} className="size-16" />
          <CardTitle className="text-lg">
            {t("web.outreach.groupParser.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder={t("web.outreach.groupParser.inputPlaceholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="bg-badge-blue border-badge-blue-foreground/10 text-foreground mt-4 space-y-3 rounded-lg border p-4">
            <div className="flex items-start gap-2">
              <InfoIcon className="mt-1 h-4 w-4 flex-shrink-0 text-blue-500" />
              <ol className="list-inside list-decimal space-y-2 text-sm">
                {(
                  t("web.outreach.groupParser.infoRow", {
                    returnObjects: true,
                  }) as string[]
                ).map((row, index) => (
                  <Trans key={index} parent="li" defaults={row} />
                ))}
              </ol>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={!value.trim() || isPending}
            onClick={async () => {
              await createGroupParseRequest({
                workspaceId,
                groupLink: value,
              });
              toast(t("web.outreach.groupParser.successToastTitle"));
              setValue("");
            }}
          >
            {t("web.outreach.groupParser.parseButton")}
          </Button>
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { InfoIcon } from "lucide-react";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { toWalletUnits } from "@repo/core/utils";

import { MiniAppPage } from "@/components/mini-app-page";
import { ToolsTabNavigation } from "@/components/tools-tab-navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MainButton } from "@/components/ui/main-button";
import { Textarea } from "@/components/ui/textarea";
import { WalletBalance } from "@/features/wallet/wallet-balance";
import { useCurrentOrganization, useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/tools/phone-numbers-converter"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const mutation = useMutation(
    trpc.outreach.tools.convertPhoneNumbersRequest.mutationOptions({
      onError: (error) => {
        toast.error(t("web.common.error.somethingWentWrong"), {
          description: error.message,
        });
      },
    })
  );

  const [value, setValue] = useState("");
  const totalCount = value.split("\n").filter((l) => l.trim()).length;

  const currentBalanceUnits = useCurrentOrganization(
    (s) => s.wallet?.balanceUnits ?? 0
  );
  const hasEnoughBalance = currentBalanceUnits >= toWalletUnits(totalCount);
  const hasEnoughRows = totalCount > 300;

  return (
    <MiniAppPage className="flex flex-col gap-4">
      <ToolsTabNavigation />
      <WalletBalance />
      {mutation.isSuccess ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("web.outreach.phoneNumbersConverter.successTitle")}
            </CardTitle>
            <CardDescription>
              <Trans
                t={t}
                parent="span"
                i18nKey="web.outreach.phoneNumbersConverter.successDescription"
                components={{
                  supportLink: (
                    <a
                      className="text-primary"
                      href="https://t.me/HintsSupportBot"
                      target="_blank"
                    >
                      @HintsSupportBot
                    </a>
                  ),
                }}
              />
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <MainButton
              variant="outline"
              className="w-full"
              onClick={() => {
                setValue("");
                mutation.reset();
              }}
            >
              {t("web.outreach.phoneNumbersConverter.convertAnotherButton")}
            </MainButton>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("web.outreach.phoneNumbersConverter.title")}
            </CardTitle>
            <CardDescription>
              {t("web.outreach.phoneNumbersConverter.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-60 font-mono transition-[height] placeholder-shown:h-28"
              placeholder={
                "+12025550100\n441523250199\n+7(993)6545032\n1(302)3432123"
              }
            />

            {totalCount > 0 && !hasEnoughRows && (
              <div className="text-destructive text-center text-sm">
                {t("web.outreach.phoneNumbersConverter.notEnoughRows")}
              </div>
            )}

            <div className="bg-badge-blue border-badge-blue-foreground/10 text-foreground space-y-3 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <InfoIcon className="mt-1 h-4 w-4 flex-shrink-0 text-blue-500" />
                <div className="space-y-2 text-sm">
                  {(
                    t("web.outreach.phoneNumbersConverter.infoRow", {
                      returnObjects: true,
                    }) as string[]
                  ).map((row, index) => (
                    <Trans key={index} parent="p" defaults={row} />
                  ))}
                </div>
              </div>
            </div>

            <MainButton
              className="w-full"
              disabled={
                totalCount === 0 ||
                mutation.isPending ||
                !hasEnoughBalance ||
                !hasEnoughRows
              }
              onClick={async () =>
                await mutation.mutateAsync({
                  workspaceId,
                  phoneNumbers: value,
                })
              }
            >
              {t("web.outreach.phoneNumbersConverter.convertButton", {
                count: totalCount,
              })}
            </MainButton>

            {!hasEnoughBalance && !mutation.isPending && (
              <div className="text-destructive text-center text-sm">
                {t("web.outreach.phoneNumbersConverter.notEnoughBalance")}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </MiniAppPage>
  );
}

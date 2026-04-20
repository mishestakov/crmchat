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
import { Input } from "@/components/ui/input";
import { MainButton } from "@/components/ui/main-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WalletBalance } from "@/features/wallet/wallet-balance";
import { useCurrentOrganization, useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/tools/lookalike-audience"
)({
  component: RouteComponent,
});

type SourceType = "phone-number" | "telegram-id" | "username" | "group";

const placeholderBySourceType: Record<SourceType, string> = {
  "phone-number": "+12025550100\n441523250199\n+7(993)6545032\n1(302)3432123",
  "telegram-id": `166094871\n218606827\n505829785`,
  username: `@GlebLevin\n@rudnikov\n@asby135`,
  group: "https://t.me/Hints_CRM_community",
};

function RouteComponent() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const mutation = useMutation(
    trpc.outreach.tools.lookalikeAudienceRequest.mutationOptions({
      onError: (error) => {
        toast.error(t("web.common.error.somethingWentWrong"), {
          description: error.message,
        });
      },
    })
  );

  const [sourceType, setSourceType] = useState<SourceType>("phone-number");
  const [value, setValue] = useState("");

  const currentBalanceUnits = useCurrentOrganization(
    (s) => s.wallet?.balanceUnits ?? 0
  );
  const hasEnoughBalance = currentBalanceUnits >= toWalletUnits(1000);

  return (
    <MiniAppPage className="flex flex-col gap-4">
      <ToolsTabNavigation />
      <WalletBalance />
      {mutation.isSuccess ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("web.outreach.lookalikeAudiences.successTitle")}
            </CardTitle>
            <CardDescription>
              <Trans
                t={t}
                parent="span"
                i18nKey="web.outreach.lookalikeAudiences.successDescription"
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
              {t("web.outreach.lookalikeAudiences.findAnotherButton")}
            </MainButton>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {t("web.outreach.lookalikeAudiences.title")}
            </CardTitle>
            <CardDescription>
              {t("web.outreach.lookalikeAudiences.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Select
              value={sourceType}
              onValueChange={(value) => setSourceType(value as SourceType)}
            >
              <SelectTrigger className="bg-card text-card-foreground w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={"phone-number" satisfies SourceType}>
                  {t("web.outreach.lookalikeAudiences.sourceType.phoneNumbers")}
                </SelectItem>
                <SelectItem value={"telegram-id" satisfies SourceType}>
                  {t("web.outreach.lookalikeAudiences.sourceType.telegramIds")}
                </SelectItem>
                <SelectItem value={"username" satisfies SourceType}>
                  {t("web.outreach.lookalikeAudiences.sourceType.usernames")}
                </SelectItem>
                <SelectItem value={"group" satisfies SourceType}>
                  {t("web.outreach.lookalikeAudiences.sourceType.group")}
                </SelectItem>
              </SelectContent>
            </Select>
            {sourceType === "group" ? (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholderBySourceType[sourceType]}
              />
            ) : (
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="h-60 font-mono transition-[height] placeholder-shown:h-28"
                placeholder={placeholderBySourceType[sourceType]}
              />
            )}

            <div className="bg-badge-blue border-badge-blue-foreground/10 text-foreground space-y-3 rounded-lg border p-4">
              <div className="flex items-start gap-2">
                <InfoIcon className="mt-1 h-4 w-4 flex-shrink-0 text-blue-500" />
                <div className="space-y-2 text-sm">
                  {(
                    t("web.outreach.lookalikeAudiences.infoRow", {
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
                value.trim().length === 0 ||
                mutation.isPending ||
                !hasEnoughBalance
              }
              onClick={async () =>
                await mutation.mutateAsync({
                  workspaceId,
                  type: sourceType,
                  values: value,
                })
              }
            >
              {t("web.outreach.lookalikeAudiences.submitButton")}
            </MainButton>

            {!hasEnoughBalance && !mutation.isPending && (
              <div className="text-destructive text-center text-sm">
                {t("web.outreach.lookalikeAudiences.notEnoughBalance")}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </MiniAppPage>
  );
}

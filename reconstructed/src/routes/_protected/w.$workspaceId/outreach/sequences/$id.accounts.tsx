import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePhoneNumber } from "react-phone-number-input";

import { OutreachSequence } from "@repo/core/types";

import premiumIcon from "@/assets/telegram-premium.png";
import { AccountStatusIndicator } from "@/components/account-status-indicator";
import { MiniAppPage } from "@/components/mini-app-page";
import { Checkbox } from "@/components/ui/checkbox";
import { MainButton } from "@/components/ui/main-button";
import { RadioButton } from "@/components/ui/radio-button";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { orpc } from "@/lib/orpc";
import { useWorkspaceStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/$id/accounts"
)({
  component: RouteComponent,
});

type AccountsConfig = NonNullable<OutreachSequence["accounts"]>;

function RouteComponent() {
  const navigateBack = useNavigateBack();
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const sequence = useWorkspaceStore((s) => s.outreachSequencesById[id]);
  const accounts = useWorkspaceStore((s) => s.telegramAccounts);
  const [mode, setMode] = useState<AccountsConfig["mode"]>();
  const [selected, setSelected] = useState<AccountsConfig["selected"]>();

  const { mutateAsync, isPending } = useMutation(
    orpc.outreach.sequences.patch.mutationOptions()
  );

  useEffect(() => {
    if (sequence && (!mode || !selected)) {
      setMode(sequence.accounts?.mode ?? "all");
      setSelected(sequence.accounts?.selected ?? []);
    }
  }, [sequence, mode, selected]);

  if (!sequence || !mode || !selected) {
    return null;
  }

  return (
    <MiniAppPage className="flex flex-col gap-4" workspaceSelector={false}>
      <Section>
        <SectionHeader>
          {t("web.outreach.sequences.accounts.header")}
        </SectionHeader>
        <SectionItems>
          <SectionItem onClick={() => setMode("all")} icon={null}>
            <RadioButton checked={mode === "all"} />
            <SectionItemTitle>
              {t("web.outreach.sequences.accounts.useAll")}
            </SectionItemTitle>
          </SectionItem>
          <SectionItem onClick={() => setMode("selected")} icon={null}>
            <RadioButton checked={mode === "selected"} />
            <SectionItemTitle>
              {t("web.outreach.sequences.accounts.useSelected")}
            </SectionItemTitle>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionItems>
          {accounts.map((account) => {
            const isSelected = selected.includes(account.id);
            return (
              <SectionItem
                key={account.id}
                className={cn(
                  mode === "all" && "pointer-events-none opacity-70"
                )}
                icon={null}
                asChild
              >
                <label>
                  <Checkbox
                    disabled={mode === "all"}
                    checked={isSelected}
                    onCheckedChange={() => {
                      setSelected((p) =>
                        p!.includes(account.id)
                          ? p!.filter((id) => id !== account.id)
                          : [...p!, account.id]
                      );
                    }}
                  />
                  <SectionItemTitle className="flex flex-col">
                    <span className="flex items-center gap-1.5">
                      <AccountStatusIndicator account={account} />
                      <span>{account.telegram.fullName}</span>
                      {account.telegram.hasPremium && (
                        <img src={premiumIcon} className="size-4" />
                      )}
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1.5 text-sm font-normal">
                      <span>
                        {parsePhoneNumber(
                          "+" + account.telegram.phone
                        )?.formatInternational()}
                      </span>
                      {account.telegram.username && (
                        <>
                          <span className="text-foreground">•</span>
                          <span>@{account.telegram.username}</span>
                        </>
                      )}
                    </span>
                  </SectionItemTitle>
                </label>
              </SectionItem>
            );
          })}
        </SectionItems>
      </Section>
      <MainButton
        loading={isPending}
        onClick={async () => {
          await mutateAsync({
            params: {
              workspaceId: sequence.workspaceId,
              sequenceId: sequence.id,
            },
            body: {
              accounts: {
                mode,
                selected,
              },
            },
          });
          navigateBack({
            fallback: {
              to: "/w/$workspaceId/outreach/sequences/$id",
              params: { workspaceId: sequence.workspaceId, id },
              replace: true,
            },
          });
        }}
      >
        {t("web.outreach.sequences.accounts.saveButton")}
      </MainButton>
    </MiniAppPage>
  );
}

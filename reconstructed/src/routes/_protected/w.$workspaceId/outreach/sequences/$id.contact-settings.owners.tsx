import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MemberAvatar } from "@/components/ui/member-avatar";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { orpc } from "@/lib/orpc";
import { useWorkspaceStore } from "@/lib/store";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/$id/contact-settings/owners"
)({
  component: ContactOwnersPage,
});

function ContactOwnersPage() {
  const { t } = useTranslation();
  const { id: sequenceId } = Route.useParams();
  const sequence = useWorkspaceStore(
    (s) => s.outreachSequencesById[sequenceId]
  );
  const workspaceId = sequence?.workspaceId ?? "";

  // Get settings from sequence data
  const settings = sequence?.contactOwnerSettings ?? null;

  // Fetch workspace members
  const { members } = useWorkspaceMembers();

  // Local state
  const [selectedOwners, setSelectedOwners] = useState<string[]>(
    settings?.ownerIds ?? []
  );

  // Sync state when settings load
  useEffect(() => {
    if (settings) {
      setSelectedOwners(settings.ownerIds);
    }
  }, [settings]);

  // Save mutation
  const { mutate: saveSettings, isPending: isSaving } = useMutation(
    orpc.outreach.sequences.patch.mutationOptions({
      onSuccess: () => {
        toast.success(
          t("web.outreach.sequences.crmSettings.owners.savedSuccess")
        );
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  // Event handlers
  const handleToggleMember = (userId: string, checked: boolean) => {
    if (checked) {
      setSelectedOwners((prev) => [...prev, userId]);
    } else {
      setSelectedOwners((prev) => prev.filter((id) => id !== userId));
    }
  };

  const handleSave = () => {
    saveSettings({
      params: { workspaceId, sequenceId },
      body: { contactOwnerSettings: { ownerIds: selectedOwners } },
    });
  };

  if (!sequence) {
    return null;
  }

  return (
    <MiniAppPage className="flex flex-col" workspaceSelector={false}>
      {/* Information Card */}
      <div className="bg-badge-blue border-badge-blue-foreground/10 text-foreground space-y-3 rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-500" />
          <Trans
            t={t}
            parent="p"
            i18nKey="web.outreach.sequences.crmSettings.owners.infoCard"
            className="space-y-2 text-sm"
          />
        </div>
      </div>

      <Section className="mt-4">
        <SectionHeader>
          {t("web.outreach.sequences.crmSettings.owners.selectMembers")}
        </SectionHeader>
        <SectionItems>
          {members?.map((member) => (
            <SectionItem key={member.userId} icon={null} asChild>
              <label>
                <Checkbox
                  checked={selectedOwners.includes(member.userId)}
                  onCheckedChange={(checked) =>
                    handleToggleMember(member.userId, checked === true)
                  }
                />
                <MemberAvatar member={member} className="size-8 text-[10px]" />
                <div className="flex min-w-0 flex-1 flex-col gap-0">
                  <SectionItemTitle>{member.user.name}</SectionItemTitle>
                  {member.user.telegramUsername && (
                    <span className="text-muted-foreground text-xs">
                      @{member.user.telegramUsername}
                    </span>
                  )}
                </div>
                <SectionItemValue>
                  {t(`web.role.${member.role}`)}
                </SectionItemValue>
              </label>
            </SectionItem>
          ))}
        </SectionItems>
      </Section>

      {/* Selection info */}
      <div className="p-3">
        <p className="text-muted-foreground text-sm">
          {selectedOwners.length === 0
            ? t("web.outreach.sequences.crmSettings.owners.noMembersSelected", {
                name:
                  members?.find((m) => m.userId === sequence.createdBy)?.user
                    .name ??
                  t(
                    "web.outreach.sequences.crmSettings.owners.sequenceCreator"
                  ),
              })
            : t("web.outreach.sequences.crmSettings.owners.membersSelected", {
                count: selectedOwners.length,
              })}
        </p>
      </div>

      {/* Save Button */}
      <div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full"
          size="lg"
        >
          {isSaving
            ? t("web.outreach.sequences.crmSettings.owners.saving")
            : t("web.outreach.sequences.crmSettings.owners.saveButton")}
        </Button>
      </div>
    </MiniAppPage>
  );
}

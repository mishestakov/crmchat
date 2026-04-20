import { useMutation } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  OutreachSequence,
  OutreachSequenceWithId,
} from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import { RadioButton } from "@/components/ui/radio-button";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { PropertyFieldsForm } from "@/features/contacts/form/property-fields-form";
import { usePropertiesWithMetadata } from "@/hooks/useProperties";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { orpc } from "@/lib/orpc";
import { useWorkspaceStore } from "@/lib/store";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/$id/contact-settings/"
)({
  component: ContactDefaultsPage,
});

type ContactCreationTrigger = NonNullable<
  OutreachSequence["contactCreationTrigger"]
>;

function ContactDefaultsPage() {
  const { t } = useTranslation();
  const { id: sequenceId } = Route.useParams();
  const sequence = useWorkspaceStore(
    (s) => s.outreachSequencesById[sequenceId]
  );
  const workspaceId = sequence?.workspaceId ?? "";

  const [properties] = usePropertiesWithMetadata("contacts");
  const editableProperties = properties.filter(
    (p) => !p.readonly && p.key !== "ownerId"
  );

  const [trigger, setTrigger] = useState<ContactCreationTrigger>(
    sequence?.contactCreationTrigger ?? "on-reply"
  );

  // Sync state when sequence loads
  useEffect(() => {
    if (sequence) {
      setTrigger(sequence.contactCreationTrigger ?? "on-reply");
    }
  }, [sequence]);

  const { mutate: saveSettings, isPending: isSaving } = useMutation(
    orpc.outreach.sequences.patch.mutationOptions({
      onSuccess: () => {
        toast.success(t("web.outreach.sequences.crmSettings.savedSuccess"));
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const defaults = useMemo(
    () => (sequence?.contactDefaults ?? {}) as Record<string, unknown>,
    [sequence?.contactDefaults]
  );
  const initialVisibleKeys = useMemo(
    () => new Set(Object.keys(defaults)),
    [defaults]
  );

  if (!sequence) {
    return null;
  }

  return (
    <MiniAppPage className="flex flex-col gap-6" workspaceSelector={false}>
      <Section>
        <SectionHeader>
          {t("web.outreach.sequences.crmSettings.triggerHeader")}
        </SectionHeader>
        <SectionItems>
          <SectionItem onClick={() => setTrigger("on-reply")} icon={null}>
            <RadioButton checked={trigger === "on-reply"} />
            <SectionItemTitle>
              {t("web.outreach.sequences.crmSettings.triggerOnReply")}
            </SectionItemTitle>
          </SectionItem>
          <SectionItem
            onClick={() => setTrigger("on-first-message-sent")}
            icon={null}
          >
            <RadioButton checked={trigger === "on-first-message-sent"} />
            <SectionItemTitle>
              {t("web.outreach.sequences.crmSettings.triggerOnFirstMessage")}
            </SectionItemTitle>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <SectionHeader>
          {t("web.outreach.sequences.crmSettings.owners.defaultOwners")}
        </SectionHeader>
        <SectionItems>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./owners">
              <SectionItemTitle>
                {t("web.outreach.sequences.crmSettings.owners.defaultOwners")}
              </SectionItemTitle>
              <SectionItemValue>
                <SelectedContactOwnersDescription sequence={sequence} />
              </SectionItemValue>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      <Section>
        <h3 className="mx-3 mb-1 text-sm font-medium">
          {t("web.outreach.sequences.crmSettings.defaultsHeader")}
        </h3>
        <p className="text-muted-foreground mx-3 mb-3 text-sm">
          {t("web.outreach.sequences.crmSettings.defaultsDescription")}
        </p>

        <div className="">
          <PropertyFieldsForm
            fieldClassName="py-1"
            properties={editableProperties}
            defaultValues={defaults}
            initialVisibleKeys={initialVisibleKeys}
            onSubmit={(contactDefaults) => {
              saveSettings({
                params: { workspaceId, sequenceId },
                body: {
                  contactCreationTrigger: trigger,
                  contactDefaults: contactDefaults as Record<
                    string,
                    string | number | boolean | string[] | null
                  >,
                },
              });
            }}
            className="flex flex-col"
          >
            {({ SubmitButton }) => (
              <SubmitButton className="mt-3 w-full" disabled={isSaving}>
                {isSaving
                  ? t("web.outreach.sequences.crmSettings.saving")
                  : t("web.outreach.sequences.crmSettings.saveButton")}
              </SubmitButton>
            )}
          </PropertyFieldsForm>
        </div>
      </Section>
    </MiniAppPage>
  );
}

function SelectedContactOwnersDescription({
  sequence,
}: {
  sequence: OutreachSequenceWithId;
}) {
  const ownerIds = sequence.contactOwnerSettings?.ownerIds ?? [];

  const { membersMap, isPending } = useWorkspaceMembers();

  if (isPending) {
    return null;
  }

  if (ownerIds.length === 0) {
    return membersMap.get(sequence.createdBy)?.user.name;
  }

  if (ownerIds.length === 1) {
    return membersMap.get(ownerIds[0]!)?.user.name;
  }

  return ownerIds.length;
}

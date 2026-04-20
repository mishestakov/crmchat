import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { LoadingScreen } from "@/components/LoadingScreen";
import { MiniAppPage } from "@/components/mini-app-page";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { FixedElement } from "@/components/ui/fixed-element";
import { Input } from "@/components/ui/input";
import { MainButton } from "@/components/ui/main-button";
import { RadioButton } from "@/components/ui/radio-button";
import { Tip } from "@/components/ui/tooltip";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useWorkspaceStore } from "@/lib/store";
import { selectEnrichedContacts } from "@/lib/store/selectors";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/add-pending-activity/$id"
)({
  validateSearch: z.object({
    select: z.string().optional(),
  }),
  component: ContactSelector,
});

function ContactSelector() {
  useClosingConfirmation();
  const { t } = useTranslation();
  const trpc = useTRPC();

  const { id: pendingActivityId } = Route.useParams();
  const { select: initialSelectedId } = Route.useSearch();

  const [searchQuery, setSearchQuery] = useState("");
  const items = useWorkspaceStore((state) =>
    selectEnrichedContacts(state, {
      q: searchQuery,
      sort: "createdAt",
      filters: {},
    })
  );
  const isContactsLoading = useWorkspaceStore((state) => state.contactsLoading);
  const workspaceId = useWorkspacesStore((state) => state.activeWorkspaceId);

  const { data: pendingActivity, isPending: isPendingActivityLoading } =
    useQuery(
      trpc.pendingContact.getPendingActivity.queryOptions({
        workspaceId: workspaceId,
        pendingActivityId: pendingActivityId,
      })
    );
  const { mutateAsync: addPendingActivity, isPending: isSaving } = useMutation(
    trpc.pendingContact.addPendingActivity.mutationOptions()
  );

  const [selectedContactId, setSelectedContactId] = useState(initialSelectedId);
  const selectedContact = items.find(
    ({ contact }) => contact.id === selectedContactId
  )?.contact;

  const onSubmit = useCallback(async () => {
    if (!selectedContactId) {
      return;
    }
    await addPendingActivity({
      workspaceId: workspaceId,
      pendingActivityId: pendingActivityId,
      toContactId: selectedContactId,
    });
    webApp?.close();
  }, [addPendingActivity, pendingActivityId, selectedContactId, workspaceId]);

  if (isContactsLoading || isPendingActivityLoading || !pendingActivity) {
    return <LoadingScreen />;
  }

  return (
    <MiniAppPage className="space-y-3 pb-24" workspaceSelector={false}>
      <h1 className="mx-3">{t("web.addPendingActivity.selectLeadTitle")}</h1>

      <Input
        className="bg-card hover:bg-card/70 h-10 rounded-lg border-none pr-9"
        placeholder={t("web.addPendingActivity.searchPlaceholder")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className="divide-background flex flex-col divide-y">
        {items.map(({ contact }) => (
          <button
            key={contact.id}
            className="bg-card hover:bg-card/70 flex items-center gap-3 px-3 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg"
            onClick={() => {
              setSelectedContactId((prev) =>
                prev === contact.id ? undefined : contact.id
              );
            }}
          >
            <RadioButton checked={selectedContactId === contact.id} />

            <ContactAvatar contact={contact} className="h-9 w-9" />
            <div className="grid gap-1">
              <p className="sensitive flex items-center gap-1 text-left text-sm font-medium leading-none">
                {contact.type === "group" && (
                  <Tip content={t("web.contacts.groupChatTooltip")}>
                    <Users className="text-muted-foreground size-3 shrink-0" />
                  </Tip>
                )}
                {contact.fullName}
              </p>
            </div>
          </button>
        ))}
      </div>
      {selectedContact && (
        <FixedElement>
          <MainButton
            className="top-[calc(var(--tg-viewport-stable-height,100vh)-4rem)] mx-auto max-w-md transition-[top]"
            onClick={onSubmit}
            loading={isSaving}
          >
            {t("web.addPendingActivity.addButton", {
              name: selectedContact.fullName ?? "",
            })}
          </MainButton>
        </FixedElement>
      )}
    </MiniAppPage>
  );
}

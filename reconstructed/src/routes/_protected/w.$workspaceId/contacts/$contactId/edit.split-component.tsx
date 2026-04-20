import { createFileRoute } from "@tanstack/react-router";
import { deleteField } from "firebase/firestore";
import { usePostHog } from "posthog-js/react";
import { mapValues } from "radashi";
import { ComponentProps, useCallback } from "react";

import ContactForm, { ContactFormValues } from "@/components/contact-form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { updateContact } from "@/lib/db/contacts";
import { useWorkspaceStore } from "@/lib/store";
import { selectContactById } from "@/lib/store/selectors";
import { webApp } from "@/lib/telegram";
import { crushObjects } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/contacts/$contactId/edit"
)({
  component: EditContact,
  validateSearch: (search) => {
    return search as {
      focus?: ComponentProps<typeof ContactForm>["focus"];
    };
  },
});

function EditContact() {
  const navigateBack = useNavigateBack();
  const posthog = usePostHog();
  const { contactId } = Route.useParams();
  const { focus } = Route.useSearch();
  const contact = useWorkspaceStore((state) =>
    selectContactById(state, contactId)
  );

  const onSubmit = useCallback(
    async (data: ContactFormValues) => {
      if (!contact?.workspaceId) return;

      webApp?.HapticFeedback.impactOccurred("medium");
      const updateData = mapValues(crushObjects(data), (v) =>
        v === undefined || v === null ? deleteField() : v
      );
      await updateContact(contact.workspaceId, contactId, updateData);

      posthog.capture("contact_updated", {
        source: "web",
        $groups: {
          workspace: contact.workspaceId,
        },
      });

      navigateBack({
        fallback: {
          to: "/w/$workspaceId/contacts/$contactId",
          params: { workspaceId: contact.workspaceId, contactId },
        },
      });
    },
    [contact?.workspaceId, contactId, navigateBack, posthog]
  );

  if (!contact) {
    return null;
  }

  return (
    <MiniAppPage className="space-y-5" workspaceSelector={false}>
      <ContactForm contact={contact} onSubmit={onSubmit} focus={focus} />
    </MiniAppPage>
  );
}

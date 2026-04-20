import { Navigate, createFileRoute, useRouter } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { useCallback } from "react";
import * as z from "zod";

import ContactForm, { ContactFormValues } from "@/components/contact-form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useCanCreateContact } from "@/hooks/subscription";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { createContact } from "@/lib/db/contacts";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { webApp } from "@/lib/telegram";
import { nullToUndefinedRecursive } from "@/lib/utils";

export const Route = createFileRoute("/_protected/w/$workspaceId/contacts/new")(
  {
    validateSearch: z.object({
      returnTo: z.string().optional(),
    }),
    component: NewContact,
  }
);

function NewContact() {
  const router = useRouter();
  const posthog = usePostHog();
  const contactsCount = useWorkspaceStore((state) => state.contacts.length);
  const workspaceId = useCurrentWorkspace((s) => s.id);

  const { returnTo } = Route.useSearch();
  const navigateBack = useNavigateBack();

  const onSubmit = useCallback(
    async (data: ContactFormValues) => {
      if (!workspaceId) {
        return;
      }

      webApp?.HapticFeedback.impactOccurred("medium");

      const createData = nullToUndefinedRecursive(data);
      const createdContact = await createContact({
        ...createData,
        workspaceId,
      });

      posthog.capture("contact_created", {
        source: "web",
        $groups: {
          workspace: workspaceId,
        },
      });
      posthog.capture("$groupidentify", {
        $group_type: "workspace",
        $group_key: workspaceId,
        $group_set: {
          contacts_count: contactsCount + 1,
        },
      });

      if (returnTo) {
        router.navigate({
          to: returnTo.replace("[id]", createdContact.id),
          replace: true,
        });
      } else {
        navigateBack({
          fallback: { to: "/w/$workspaceId/contacts", params: { workspaceId } },
        });
      }
    },
    [contactsCount, navigateBack, router, workspaceId, posthog, returnTo]
  );

  const canCreateContact = useCanCreateContact();
  if (!canCreateContact) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/subscription"
        params={{ workspaceId }}
        search={{ minPlan: "pro" }}
      />
    );
  }

  return (
    <MiniAppPage className="space-y-5">
      <ContactForm onSubmit={onSubmit} />
    </MiniAppPage>
  );
}

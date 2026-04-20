import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import * as z from "zod";

import { LoadingScreen } from "@/components/LoadingScreen";
import { NewActivityForm } from "@/components/activity-form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useWorkspaceStore } from "@/lib/store";
import { selectContactById } from "@/lib/store/selectors";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/contacts/$contactId/activities/new"
)({
  component: NewActivity,
  validateSearch: z.object({
    type: z.enum(["note", "task"]).default("note"),
  }),
});

function NewActivity() {
  const navigateBack = useNavigateBack();
  const { workspaceId, contactId } = Route.useParams();
  const { type } = Route.useSearch();

  const contact = useWorkspaceStore((state) =>
    selectContactById(state, contactId)
  );

  const onSuccess = useCallback(
    async function onSuccess() {
      navigateBack({
        fallback: {
          to: "/w/$workspaceId/contacts/$contactId",
          params: { workspaceId, contactId },
        },
      });
    },
    [navigateBack, workspaceId, contactId]
  );

  if (!contact) {
    return <LoadingScreen />;
  }

  return (
    <MiniAppPage workspaceSelector={false}>
      <NewActivityForm type={type} contact={contact} onSuccess={onSuccess} />
    </MiniAppPage>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

import { EditActivityForm } from "@/components/activity-form";
import { MiniAppPage } from "@/components/mini-app-page";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useWorkspaceStore } from "@/lib/store";
import { selectActivityById } from "@/lib/store/selectors";
import { webApp } from "@/lib/telegram";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/contacts/$contactId/activities/$activityId/edit"
)({
  component: EditActivity,
});

function EditActivity() {
  const navigateBack = useNavigateBack();
  const { activityId } = Route.useParams();
  const activity = useWorkspaceStore((state) =>
    selectActivityById(state, activityId)
  );

  useEffect(() => {
    if (!webApp?.isExpanded) {
      webApp?.expand();
    }
  }, []);

  const onSuccess = useCallback(async () => {
    navigateBack({
      fallback: {
        to: "/w/$workspaceId/contacts/$contactId",
        params: {
          workspaceId: activity?.workspaceId,
          contactId: activity?.contactId,
        },
      },
    });
  }, [activity?.workspaceId, activity?.contactId, navigateBack]);

  if (!activity) {
    return null;
  }

  return (
    <MiniAppPage className="space-y-5" workspaceSelector={false}>
      <EditActivityForm activity={activity} onSuccess={onSuccess} />
    </MiniAppPage>
  );
}

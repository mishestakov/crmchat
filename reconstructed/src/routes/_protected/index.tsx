import { Navigate, createFileRoute } from "@tanstack/react-router";

import { LoadingScreen } from "@/components/LoadingScreen";
import { NewWorkspaceModal } from "@/features/workspaces/new-workspace-modal";
import { useUser } from "@/hooks/useUser";

export const Route = createFileRoute("/_protected/")({
  component: RouteComponent,
});

function RouteComponent() {
  const user = useUser();
  if (!user) {
    return <LoadingScreen />;
  }

  if (user.workspaces.length === 0) {
    return <NewWorkspaceModal />;
  }

  return (
    <Navigate
      to="/w/$workspaceId"
      params={{ workspaceId: user.workspaces[0]! }}
      replace
    />
  );
}

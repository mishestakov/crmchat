import { Navigate, createFileRoute, useLocation } from "@tanstack/react-router";

import { LoadingScreen } from "@/components/LoadingScreen";
import { NewWorkspaceModal } from "@/features/workspaces/new-workspace-modal";
import { useUser } from "@/hooks/useUser";

export const Route = createFileRoute("/_protected/mini-app/$")({
  component: RouteComponent,
});

function RouteComponent() {
  const user = useUser();
  const location = useLocation();
  const { _splat } = Route.useParams();

  if (!user) {
    return <LoadingScreen />;
  }

  if (user.workspaces.length === 0) {
    return <NewWorkspaceModal />;
  }

  return (
    <Navigate
      to={
        `/w/${user.workspaces[0]!}/${_splat ?? ""}${location.searchStr}` as any
      }
      replace
    />
  );
}

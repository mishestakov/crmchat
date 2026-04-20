import {
  Outlet,
  createFileRoute,
  notFound,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { PropsWithChildren, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { formatUsername } from "@repo/core/utils";

import { LoadingScreen } from "@/components/LoadingScreen";
import { FlowsOnboardingProvider } from "@/components/providers/flows-onboarding-provider";
import { Button } from "@/components/ui/button";
import { NewWorkspaceModal } from "@/features/workspaces/new-workspace-modal";
import { useAuthContext, useUser } from "@/hooks/useUser";
import { auth } from "@/lib/firebase";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { webApp } from "@/lib/telegram";

export const Route = createFileRoute("/_protected/w/$workspaceId")({
  component: MiniAppLayout,
});

function MiniAppLayout() {
  const { workspaceId } = Route.useParams();
  return (
    <FlowsOnboardingProvider workspaceId={workspaceId}>
      <MiniAppConfigurator />
      <RealtimeWorkspace />

      <MiniAppLoader>
        <AuthInfoPanel />
        <Outlet />
      </MiniAppLoader>
    </FlowsOnboardingProvider>
  );
}

function MiniAppLoader({ children }: PropsWithChildren) {
  const workspacesLoading = useWorkspacesStore(
    (store) => store.workspacesLoading
  );
  const workspaceDataInitializing = useWorkspaceStore((store) => !store);
  const activeWorkspaceLoading = useCurrentWorkspace((store) => !store);

  if (
    workspacesLoading ||
    workspaceDataInitializing ||
    activeWorkspaceLoading
  ) {
    return <LoadingScreen />;
  }

  return children;
}

function useSettingsButton() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!webApp) return;
    const openSettings = () =>
      navigate({ from: Route.fullPath, to: "./settings" });

    webApp.SettingsButton.onClick(openSettings);
    webApp.SettingsButton.show();
    return () => {
      webApp!.SettingsButton.hide();
      webApp!.SettingsButton.offClick(openSettings);
    };
  }, [navigate]);
}

function useBackButton() {
  const { history } = useRouter();
  const canGoBack = useCanGoBack();

  useEffect(() => {
    if (!webApp) return;

    if (canGoBack) {
      webApp.BackButton.show();
    } else {
      webApp.BackButton.hide();
    }
    webApp.BackButton.onClick(history.back);
    return () => {
      webApp!.BackButton.offClick(history.back);
    };
  }, [canGoBack, history.back]);
}

function RealtimeWorkspace() {
  const user = useUser();
  const {
    activeWorkspaceId,
    subscriptionsEnabled,
    setActiveWorkspaceId,
    subscribeToOrganizations,
    subscribeToUserWorkspaces,
    subscribeToWorkspaceData,
  } = useWorkspacesStore(
    useShallow((store) => ({
      activeWorkspaceId: store.activeWorkspaceId,
      subscriptionsEnabled: store.subscriptionsEnabled,
      setActiveWorkspaceId: store.setActiveWorkspaceId,
      subscribeToOrganizations: store.subscribeToOrganizations,
      subscribeToUserWorkspaces: store.subscribeToUserWorkspaces,
      subscribeToWorkspaceData: store.subscribeToWorkspaceData,
    }))
  );

  const organizationIds = useMemo(() => {
    return user?.organizations ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.organizations?.join(",")]);

  const workspaceIds = useMemo(() => {
    return user?.workspaces ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.workspaces?.join(",")]);

  const { workspaceId } = Route.useParams();
  useEffect(() => {
    if (!workspaceIds) return; // still loading

    console.info("Setting active workspace", workspaceId);
    if (workspaceIds.includes(workspaceId)) {
      setActiveWorkspaceId(workspaceId);
    } else {
      throw notFound();
    }
  }, [workspaceId, setActiveWorkspaceId, workspaceIds]);

  useEffect(() => {
    if (!organizationIds) return; // still loading

    console.info("Subscribing to list of organizations", organizationIds);
    const unsubscribe = subscribeToOrganizations(organizationIds);
    return () => {
      console.info("Unsubscribing from list of organizations");
      unsubscribe();
    };
  }, [subscribeToOrganizations, organizationIds]);

  useEffect(() => {
    if (!user?.id) return;

    console.info("Subscribing to user workspaces", user.id);
    const unsubscribe = subscribeToUserWorkspaces(user.id);
    return () => {
      console.info("Unsubscribing from user workspaces", user.id);
      unsubscribe();
    };
  }, [subscribeToUserWorkspaces, user?.id]);

  useEffect(() => {
    if (!activeWorkspaceId || !subscriptionsEnabled) return;

    console.info("Subscribing to workspace data", activeWorkspaceId);
    const unsubscribe = subscribeToWorkspaceData(activeWorkspaceId);
    return () => {
      console.info("Unsubscribing from workspace data", activeWorkspaceId);
      unsubscribe();
    };
  }, [subscribeToWorkspaceData, activeWorkspaceId, subscriptionsEnabled]);

  if (workspaceIds && workspaceIds.length === 0) {
    return <NewWorkspaceModal />;
  }

  return null;
}

function MiniAppConfigurator() {
  useSettingsButton();
  useBackButton();
  return null;
}

function AuthInfoPanel() {
  const authState = useAuthContext();
  if (authState.status !== "authenticated") {
    return null;
  }
  if (!authState.claims?._imp) {
    return null;
  }
  return (
    <div className="mb-4 flex w-full items-center justify-end gap-4 bg-yellow-400 px-3 py-1 text-xs text-black">
      Logged in as {authState.user.displayName} /{" "}
      {formatUsername(authState.user.telegram?.username)}
      <Button
        className="bg-transparent text-yellow-900"
        variant="link"
        size="xs"
        onClick={() => {
          auth.signOut();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

import { useShallow } from "zustand/react/shallow";

import {
  OrganizationWithId,
  Subscription,
  WorkspaceWithId,
} from "@repo/core/types";

import { WorkspaceState, useWorkspacesStore } from "./workspaces";

export function useWorkspaceStore<T>(
  selector: (state: WorkspaceState) => T
): T {
  return useWorkspacesStore(
    useShallow((state) =>
      selector(state.workspaceData[state.activeWorkspaceId]!)
    )
  );
}

export function useCurrentOrganization<T>(
  selector: (state: OrganizationWithId) => T
): T {
  return useWorkspacesStore(
    useShallow((state) => {
      const organizationId =
        state.workspacesById[state.activeWorkspaceId]!.organizationId;
      if (!organizationId) {
        throw new Error("Organization not found");
      }
      return selector(state.organizationsById[organizationId]!);
    })
  );
}

export function useCurrentWorkspace<T>(
  selector: (state: WorkspaceWithId) => T
): T {
  return useWorkspacesStore(
    useShallow((state) =>
      selector(state.workspacesById[state.activeWorkspaceId]!)
    )
  );
}

export function useActiveSubscription<T>(
  selector: (state: Subscription) => T
): T | undefined {
  return useWorkspacesStore(
    useShallow((state) => {
      const workspace = state.workspacesById[state.activeWorkspaceId]!;

      const organization = state.organizationsById[workspace.organizationId];
      if (organization?.subscription?.active) {
        return selector(organization.subscription);
      }

      return undefined;
    })
  );
}

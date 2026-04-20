import { AppFeature } from "@repo/core/types";

import { useUser } from "./useUser";
import { useCurrentWorkspace } from "@/lib/store";

export function useHasFeatureFlag(feature: AppFeature) {
  const user = useUser();
  const hasWorkspaceFeature = useCurrentWorkspace((s) =>
    s.features?.includes(feature)
  );
  const hasUserFeature = user?.features?.includes(feature);
  return hasWorkspaceFeature || hasUserFeature;
}

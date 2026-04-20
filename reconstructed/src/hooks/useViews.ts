import { TFunction } from "i18next";
import { isEqual } from "radashi";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { View, WorkspaceObjectType } from "@repo/core/types";

import { updateViews } from "@/lib/db/workspaces";
import { useCurrentWorkspace } from "@/lib/store";

const createDefaultViews = (t: TFunction): View[] => [
  {
    id: "list",
    name: t("web.views.list"),
    type: "list",
    filters: {},
    sort: "default",
  },
  {
    id: "pipeline",
    name: t("web.views.pipeline"),
    type: "pipeline",
    pipelineProperty: null,
    filters: {},
    sort: "default",
  },
];

export function useViews(objectType: WorkspaceObjectType) {
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const rawViews = useCurrentWorkspace((state) => state.views);
  const { t } = useTranslation();

  const defaultViews = useMemo(() => createDefaultViews(t), [t]);

  const views = useMemo(() => {
    if (rawViews?.[objectType]) {
      // make sure that "list" and "pipeline" views are always first and present

      const existingViews = rawViews[objectType];
      const listView = existingViews.find((v) => v.id === "list");
      const pipelineView = existingViews.find((v) => v.id === "pipeline");
      const otherViews = existingViews.filter(
        (v) => v.id !== "list" && v.id !== "pipeline"
      );

      return [
        listView || defaultViews[0]!,
        pipelineView || defaultViews[1]!,
        ...otherViews,
      ];
    }
    return defaultViews;
  }, [rawViews, objectType, defaultViews]);

  const _updateViews = useCallback(
    async (views: View[]) => {
      if (workspaceId) {
        // make sure that "list" and "pipeline" views are always first

        const listView = views.find((v) => v.id === "list");
        const pipelineView = views.find((v) => v.id === "pipeline");
        const otherViews = views.filter(
          (v) => v.id !== "list" && v.id !== "pipeline"
        );

        const viewsToStore = [
          ...(isEqual(listView, defaultViews[0]) ? [] : [listView!]),
          ...(isEqual(pipelineView, defaultViews[1]) ? [] : [pipelineView!]),
          ...otherViews,
        ];

        await updateViews(workspaceId, objectType, viewsToStore);
      } else {
        console.error("Workspace not found in store.");
      }
    },
    [objectType, workspaceId, defaultViews]
  );

  return {
    views,
    updateViews: _updateViews,
  };
}

export function useView(
  objectType: WorkspaceObjectType,
  id: View["id"] | null | undefined
) {
  const { views } = useViews(objectType);
  return views.find((v) => v.id === id) ?? views[0]!;
}

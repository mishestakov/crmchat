import { getRouteApi } from "@tanstack/react-router";
import { useEffect } from "react";

import { View, ViewOptions, ViewOptionsSchema } from "@repo/core/types";

import { useViews } from "@/hooks/useViews";
import { useCurrentWorkspace } from "@/lib/store";
import { removeDefaultValues } from "@/lib/utils";

const route = getRouteApi("/_protected/w/$workspaceId/contacts/");

const ViewOptionsPartialSchema = ViewOptionsSchema.partial();

export function normalizeViewOptions(view: Partial<ViewOptions>) {
  const normalized = { ...view };
  if (normalized.filters && Object.keys(normalized.filters).length === 0) {
    delete normalized.filters;
  }
  if (normalized.q === "") {
    delete normalized.q;
  }

  if (normalized.type === "pipeline") {
    normalized.pipelineProperty = normalized.pipelineProperty ?? "";
    normalized.hideEmptyColumns = normalized.hideEmptyColumns ?? false;
  } else {
    delete normalized.pipelineProperty;
    delete normalized.hideEmptyColumns;
  }

  return normalized;
}

function readFromLocalStorage(workspaceId: string, viewId: string) {
  const key = `filters/${workspaceId}/contacts/${viewId}`;
  const view = localStorage.getItem(key);
  try {
    const parsed = JSON.parse(view ?? "{}");
    return ViewOptionsPartialSchema.safeParse(parsed).data;
  } catch {
    console.error(`Failed to parse view options from localStorage: ${key}`);
    return undefined;
  }
}

function writeToLocalStorage(
  workspaceId: string,
  viewId: string,
  view: Partial<ViewOptions>
) {
  const key = `filters/${workspaceId}/contacts/${viewId}`;
  localStorage.setItem(key, JSON.stringify(view));
}

export function useViewOptions(): [View, (data: Partial<ViewOptions>) => void] {
  const search = route.useSearch();
  const navigate = route.useNavigate();

  const workspaceId = useCurrentWorkspace((w) => w.id);

  const { views } = useViews("contacts");
  const defaultView = views[0]!;
  const viewId = search.view ?? defaultView.id;
  const baseView = views.find((v) => v.id === viewId) ?? defaultView;
  const view = { ...baseView, ...search.viewOptions };

  useEffect(() => {
    const hasOptionsInSearch = Object.keys(search.viewOptions ?? {}).length > 0;
    if (hasOptionsInSearch) {
      return;
    }
    const localStorageViewOptions = readFromLocalStorage(workspaceId, viewId);
    if (
      !localStorageViewOptions ||
      Object.keys(localStorageViewOptions).length === 0
    ) {
      return;
    }
    navigate({
      search: (prev) => ({ ...prev, viewOptions: localStorageViewOptions }),
      viewTransition: false,
      replace: true,
    });
  }, [workspaceId, viewId, search.viewOptions, navigate]);

  return [
    view,
    (data) => {
      navigate({
        search: (prev) => {
          const targetViewOptions = { ...prev.viewOptions, ...data };
          const nextViewOptions = removeDefaultValues(
            normalizeViewOptions(targetViewOptions),
            baseView
          );
          writeToLocalStorage(workspaceId, viewId, nextViewOptions);
          return {
            ...prev,
            viewOptions:
              Object.keys(nextViewOptions).length > 0
                ? nextViewOptions
                : undefined,
          };
        },
        replace: true,
        viewTransition: false,
      });
    },
  ];
}

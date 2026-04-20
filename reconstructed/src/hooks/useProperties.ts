import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Property, WorkspaceObjectType } from "@repo/core/types";
import { enrichCustomProperties } from "@repo/core/utils";

import { updateProperties } from "@/lib/db/workspaces";
import { PROPERTY_METADATA } from "@/lib/properties";
import { useCurrentWorkspace } from "@/lib/store";

export const useCreateablePropertiesMetadata = () => {
  const { t } = useTranslation();
  return useMemo(
    () =>
      Object.entries(PROPERTY_METADATA)
        .filter(([_, p]) => p.createable)
        .map(([type, value]) => ({
          type: type as Property["type"],
          name: t(value.name),
        })),
    [t]
  );
};

const EMPTY_PROPERTIES: Property[] = [];
export function useProperties(objectType: WorkspaceObjectType) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const properties = useCurrentWorkspace(
    (state) => state.properties?.[objectType] ?? EMPTY_PROPERTIES
  );
  const enrichedProperties = useMemo(
    () => enrichCustomProperties(objectType, properties, t),
    [properties, objectType, t]
  );

  const update = useCallback(
    async (properties: Property[]) => {
      if (workspaceId) {
        await updateProperties(workspaceId, objectType, properties);
      } else {
        console.error("Workspace not found in store.");
      }
    },
    [objectType, workspaceId]
  );

  return [enrichedProperties, update] as const;
}

export function useDisplayedProperties(objectType: WorkspaceObjectType) {
  const [properties] = useProperties(objectType);
  return useMemo(
    () => properties.filter((p) => "displayedInList" in p && p.displayedInList),
    [properties]
  );
}

export function usePropertiesWithMetadata(objectType: WorkspaceObjectType) {
  const { t } = useTranslation();
  const [properties] = useProperties(objectType);
  const enrichedProperties = useMemo(
    () =>
      properties.map((p) => {
        const metadata = PROPERTY_METADATA[p.type];
        return {
          ...p,
          metadata: {
            ...metadata,
            name: t(metadata.name),
          },
        };
      }),
    [properties, t]
  );
  return [enrichedProperties] as const;
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as z from "zod";

import { selectPropertySchema } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import { PropertyForm } from "@/components/property-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useProperties } from "@/hooks/useProperties";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/properties/$objectType/new/$type"
)({
  component: NewProperty,
  validateSearch: z
    .object({
      data: selectPropertySchema
        .pick({
          key: true,
          name: true,
          required: true,
          displayedInList: true,
          options: true,
        })
        .partial(),
      returnTo: z.string().optional(),
    })
    .partial(),
});

function NewProperty() {
  useFormFeatures();
  const { workspaceId, objectType, type } = Route.useParams();
  const { data: initialData, returnTo } = Route.useSearch();
  const [properties, updateProperties] = useProperties(objectType as any);
  const navigate = useNavigate();
  const navigateBack = useNavigateBack();

  return (
    <MiniAppPage className="flex flex-col gap-5">
      <PropertyForm
        type={type as any}
        onSubmit={(newProperty) => {
          updateProperties([...properties, newProperty]);
          if (returnTo) {
            navigate({
              to: returnTo.replace("[id]", newProperty.key),
              replace: true,
            });
          } else {
            navigateBack({
              fallback: {
                to: "/w/$workspaceId/settings/properties/$objectType",
                params: { workspaceId, objectType },
                replace: true,
              },
            });
          }
        }}
        initialData={initialData}
      />
    </MiniAppPage>
  );
}

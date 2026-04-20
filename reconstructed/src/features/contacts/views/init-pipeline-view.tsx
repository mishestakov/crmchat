import { getRouteApi } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ContactViewFilters } from "../contact-view-filters";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { ResponsivePage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SeparatorWithText } from "@/components/ui/separator";
import { useProperties } from "@/hooks/useProperties";
import { useViews } from "@/hooks/useViews";
import { getDefaultPipelineStages } from "@/lib/properties";
import { useCurrentWorkspace } from "@/lib/store";

const Route = getRouteApi("/_protected/w/$workspaceId/contacts/");

export function InitPipeline() {
  const { t } = useTranslation();
  const posthog = usePostHog();

  const workspaceId = useCurrentWorkspace((w) => w.id);
  const [properties] = useProperties("contacts");
  const availableProperties = properties
    .filter((p) => p.type === "single-select")
    .map((p) => ({ value: p.key, label: p.name }));

  const [pipelineProperty, setPipelineProperty] = useState<string | null>(null);

  const { views, updateViews } = useViews("contacts");

  const createPipeline = useCallback(
    async (propertyPath: string) => {
      await updateViews(
        views.map((view) =>
          view.id === "pipeline"
            ? { ...view, pipelineProperty: propertyPath }
            : view
        )
      );
      posthog.capture("pipeline_created", {
        $groups: {
          workspace: workspaceId,
        },
      });
    },
    [views, updateViews, posthog, workspaceId]
  );

  const { newPipeline: newPipelineProperty } = Route.useSearch();
  const navigate = Route.useNavigate();
  const isPipelineCreated = useRef(false);
  useEffect(() => {
    const selectedProperty = availableProperties.find(
      (p) => p.value === newPipelineProperty
    );
    if (selectedProperty && !isPipelineCreated.current) {
      isPipelineCreated.current = true;
      createPipeline(selectedProperty.value);

      // Remove the newPipeline property from the URL
      navigate({ search: (prev) => ({ ...prev, newPipeline: undefined }) });
    }
  }, [navigate, createPipeline, newPipelineProperty, availableProperties]);

  const createNewProperty = () => {
    navigate({
      to: "../settings/properties/$objectType/new/$type",
      params: { objectType: "contacts", type: "single-select" },
      search: {
        data: {
          name: t("web.defaultPipelineProperty.name"),
          required: true,
          options: getDefaultPipelineStages(t),
        },
        returnTo: `/w/${workspaceId}/contacts?view=pipeline&newPipeline=[id]`,
      },
    });
  };

  return (
    <ResponsivePage size="extra-wide" helpButton={false}>
      <ContactViewFilters />
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 px-12 text-center">
        <ZapIcon className="text-muted-foreground h-12 w-12" />
        <h2 className="text-xl font-semibold">Let's setup a pipeline</h2>

        {availableProperties.length > 0 ? (
          <>
            <p className="text-muted-foreground text-sm">
              Choose a property to define your stages
            </p>

            <Combobox
              className="max-w-xs"
              options={availableProperties}
              value={pipelineProperty}
              onChange={(propertyKey) => {
                setPipelineProperty(propertyKey);
              }}
              placeholder="Choose a property"
            />
            <AnimateChangeInHeight>
              {pipelineProperty ? (
                <Button
                  className="block w-full max-w-xs"
                  onClick={() => createPipeline(pipelineProperty)}
                >
                  Create Pipeline
                </Button>
              ) : (
                <>
                  <SeparatorWithText
                    text="or"
                    className="w-full max-w-xs text-sm"
                  />

                  <Button variant="link" onClick={createNewProperty}>
                    Create a new property
                  </Button>
                </>
              )}
            </AnimateChangeInHeight>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Start by creating a property to define your pipeline stages.
            </p>
            <Button variant="link" onClick={createNewProperty}>
              Create property
            </Button>
          </>
        )}
      </div>
    </ResponsivePage>
  );
}

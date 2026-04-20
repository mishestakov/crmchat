import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GripVertical, HelpCircle, Plus } from "lucide-react";
import { Reorder, useDragControls } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Property, WorkspaceObjectType } from "@repo/core/types";

import PipelineTutorial from "@/assets/onboarding/pipeline_create.mp4";
import { MiniAppPage } from "@/components/mini-app-page";
import { NewPropertyButton } from "@/components/new-property-button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { useDisabledVerticalSwipe } from "@/hooks/useDisabledVerticalSwipe";
import { useProperties } from "@/hooks/useProperties";
import { webApp } from "@/lib/telegram";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/properties/$objectType/"
)({
  component: PropertiesList,
  validateSearch: z
    .object({
      fromPipeline: z.coerce.boolean().optional(),
    })
    .partial(),
});

function PropertiesList() {
  useDisabledVerticalSwipe();
  const { t } = useTranslation();
  const { objectType } = Route.useParams();
  const { fromPipeline } = Route.useSearch();
  const navigate = useNavigate();
  const [properties, updateProperties] = useProperties(
    objectType as WorkspaceObjectType
  );
  const [isDragging, setIsDragging] = useState(false);

  return (
    <MiniAppPage className="flex flex-col gap-5">
      <Section>
        <SectionHeader>{t("web.properties.list.title")}</SectionHeader>
        <SectionItems asChild>
          <Reorder.Group
            axis="y"
            values={properties}
            onReorder={(ordered) => {
              webApp?.HapticFeedback.impactOccurred("light");
              updateProperties(ordered);
            }}
            as="div"
          >
            {properties.map((property) => (
              <PropertyRow
                key={property.key}
                property={property}
                onClick={() => {
                  if (!isDragging) {
                    navigate({
                      to: "$key/edit",
                      from: Route.fullPath,
                      params: { key: property.key },
                    });
                  }
                }}
                onDragStart={() => setIsDragging(true)}
                onDragEnd={() => setTimeout(() => setIsDragging(false), 100)}
              />
            ))}

            <NewPropertyButton objectType={objectType as WorkspaceObjectType}>
              <SectionItem
                className="text-muted-foreground hover:text-foreground w-full transition-colors"
                icon={null}
              >
                <Plus className="text-muted-foreground size-4 cursor-grab" />
                <SectionItemTitle className="mr-auto">
                  {t("web.properties.list.newPropertyButton")}
                </SectionItemTitle>
              </SectionItem>
            </NewPropertyButton>
          </Reorder.Group>
        </SectionItems>
        <SectionDescription>
          {t("web.properties.list.dragDescription")}
        </SectionDescription>
      </Section>
      <Section>
        <Accordion
          type="single"
          collapsible
          defaultValue={fromPipeline ? "help" : undefined}
        >
          <AccordionItem value="help">
            <AccordionTrigger>
              <div className="flex items-center gap-3">
                <HelpCircle className="size-4" />
                <span>{t("web.properties.list.helpTitle")}</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p className="text-muted-foreground text-sm">
                {t("web.properties.list.helpDescription1")}
              </p>
              <ul className="text-muted-foreground list-inside list-disc pl-4 text-sm">
                <li>{t("web.properties.list.helpItemText")}</li>
                <li>{t("web.properties.list.helpItemNumber")}</li>
                <li>{t("web.properties.list.helpItemDate")}</li>
                <li>{t("web.properties.list.helpItemSelect")}</li>
                <li>{t("web.properties.list.helpItemEtc")}</li>
              </ul>
              <p className="text-muted-foreground text-sm">
                {t("web.properties.list.helpVideoDescription")}
              </p>
              <video
                className="mt-4 w-full rounded-lg"
                src={PipelineTutorial}
                autoPlay
                muted
                controls
                poster="/images/properties-tutorial-poster.jpg"
              >
                {t("web.properties.list.helpVideoFallback")}
              </video>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Section>
    </MiniAppPage>
  );
}

function PropertyRow({
  property,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  property: Property;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  const disabled = property.readonly || property.internal;
  return (
    <SectionItem
      asChild
      icon={disabled ? null : undefined}
      className={cn("w-full", {
        "cursor-default": disabled,
      })}
      type="button"
    >
      <Reorder.Item
        value={property}
        as="button"
        onClick={() => (disabled ? null : onClick())}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        dragListener={false}
        dragControls={controls}
      >
        <GripVertical
          className="text-muted-foreground size-4 cursor-grab"
          onPointerDown={(e) => controls.start(e)}
          style={{ touchAction: "none" }}
        />
        <SectionItemTitle className="mr-auto">{property.name}</SectionItemTitle>
      </Reorder.Item>
    </SectionItem>
  );
}

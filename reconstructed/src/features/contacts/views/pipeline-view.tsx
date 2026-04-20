import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { useElementScrollRestoration } from "@tanstack/react-router";
import { get } from "radashi";
import { useEffect, useRef } from "react";

import { SingleSelectProperty, View } from "@repo/core/types";

import { ContactViewFilters, NO_VALUE_OPTION } from "../contact-view-filters";
import { InitPipeline } from "./init-pipeline-view";
import { PipelineColumn } from "./pipeline-column";
import { PipelineTabs } from "./pipeline-tabs";
import { SelectionActions } from "./selection-actions";
import { useViewContext } from "./view-context";
import { ResponsivePage } from "@/components/mini-app-page";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { useDisabledVerticalSwipe } from "@/hooks/useDisabledVerticalSwipe";
import { useExpandedView } from "@/hooks/useExpandedView";
import { useDisplayedProperties, useProperties } from "@/hooks/useProperties";
import { EnrichedContact } from "@/lib/store/selectors";
import { cn } from "@/lib/utils";

function usePipelineProperty(view: View) {
  const [properties] = useProperties("contacts");

  const propertyKey = view.pipelineProperty;
  return properties.find(
    (p): p is SingleSelectProperty =>
      p.key === propertyKey && p.type === "single-select"
  );
}

type GroupedItems = Record<string, EnrichedContact[]>;
function groupItems(
  items: EnrichedContact[],
  property: SingleSelectProperty | undefined
): GroupedItems {
  if (!property?.key) {
    return {};
  }

  const optionValues = new Set(property?.options?.map((o) => o.value));
  const grouped: Record<string, any> = {};
  for (const item of items) {
    let value: string = get(item.contact, property.key, "");
    if (!optionValues.has(value)) {
      value = NO_VALUE_OPTION.value;
    }
    grouped[value] ??= [];
    grouped[value].push(item);
  }
  return grouped;
}

function getVisibleColumns(
  groupedItems: GroupedItems,
  property: SingleSelectProperty | undefined,
  view: View
) {
  let baseOptions = groupedItems[NO_VALUE_OPTION.value]?.length
    ? [NO_VALUE_OPTION, ...(property?.options ?? [])]
    : (property?.options ?? []);

  const filteredValues = new Set(view.filters?.[property?.key ?? ""] ?? []);
  if (filteredValues.size > 0) {
    baseOptions = baseOptions.filter((o) => filteredValues.has(o.value));
  }

  if (view.hideEmptyColumns) {
    return baseOptions.filter(
      (option) => (groupedItems[option.value]?.length ?? 0) > 0
    );
  }

  return baseOptions;
}

const SCROLL_RESTORATION_ID = "pipeline-view";

export function PipelineView() {
  useExpandedView();
  useDisabledVerticalSwipe();

  const { view, items, useNewUnread } = useViewContext();

  const property = usePipelineProperty(view);
  const groupedItems = groupItems(items, property);

  const displayedProperties = useDisplayedProperties("contacts");
  const showColors = property?.options?.some((o) => o.color);

  const visibleColumns = getVisibleColumns(groupedItems, property, view);

  const scrollElementRef = useRef<HTMLDivElement>(null);
  useElementScrollRestoration({ id: SCROLL_RESTORATION_ID });

  useEffect(() => {
    if (!scrollElementRef.current) return;

    return autoScrollForElements({
      element: scrollElementRef.current,
    });
  }, []);

  if (!property) {
    return <InitPipeline />;
  }

  return (
    <ResponsivePage
      size="extra-wide"
      containerClassName="max-h-dvh"
      className="flex flex-col items-stretch !pb-0"
      helpButton={false}
    >
      <ContactViewFilters />
      <SelectionActions
        className="@desktop:mt-3 @desktop:px-3 px-2"
        checkbox={<Checkbox className="@desktop:hidden" disabled />}
      />
      <PipelineTabs
        className="sm:hidden"
        options={visibleColumns}
        scrollElementRef={scrollElementRef}
      />
      <ScrollAreaRoot
        className={cn(
          "@desktop:mt-3 flex min-h-0 flex-auto",
          "@desktop:-ml-5 @desktop:-mr-3 -mx-3"
        )}
      >
        <ScrollAreaViewport
          ref={scrollElementRef}
          className={cn(
            "flex min-h-0 snap-x snap-mandatory sm:snap-none [&>div]:!flex [&>div]:!min-h-0 [&>div]:w-auto [&>div]:!min-w-[auto] [&>div]:gap-3",
            "@desktop:pl-5 px-3"
          )}
          data-scroll-restoration-id={SCROLL_RESTORATION_ID}
        >
          {visibleColumns.map((option) => {
            return (
              <PipelineColumn
                key={option.value}
                className="w-screen shrink-0 grow-0 sm:w-64"
                // style={{
                //   width: virtualItem.size,
                // }}
                propertyKey={property.key}
                option={option}
                items={groupedItems[option.value] ?? []}
                displayedProperties={displayedProperties}
                showColor={showColors}
                useNewUnread={useNewUnread}
              />
            );
          })}

          <ScrollBar className="mb-0" orientation="horizontal" />
        </ScrollAreaViewport>
      </ScrollAreaRoot>
    </ResponsivePage>
  );
}

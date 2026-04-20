import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useElementScrollRestoration } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  PropsWithChildren,
  RefCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { Property, SelectOption } from "@repo/core/types";

import { NO_VALUE_OPTION } from "../contact-view-filters";
import {
  ContactCardAvatar,
  ContactCardCheckbox,
  ContactCardContent,
  ContactCardRoot,
} from "./contact-card";
import { useViewContext } from "./view-context";
import { Badge } from "@/components/ui/badge";
import { ColorBubble } from "@/components/ui/color-bubble";
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
} from "@/components/ui/scroll-area";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useVirtualizer } from "@/hooks/virtualizer";
import { updateContact } from "@/lib/db/contacts";
import { useCurrentWorkspace } from "@/lib/store";
import { EnrichedContact } from "@/lib/store/selectors";
import { cn, isIOS } from "@/lib/utils";

function formatCompactNumber(value: number): string {
  if (value === 0) return "0";

  const tiers = [
    { threshold: 1e9, suffix: "B" },
    { threshold: 1e6, suffix: "M" },
    { threshold: 1e3, suffix: "k" },
  ];

  for (const { threshold, suffix } of tiers) {
    if (value >= threshold) {
      return (value / threshold).toFixed(1).replace(/\.0$/, "") + suffix;
    }
  }

  return value.toString();
}

export function PipelineColumn({
  ref,
  className,
  propertyKey,
  option,
  items,
  showColor,
  displayedProperties,
  useNewUnread,
  index,
  style,
}: PropsWithChildren<{
  ref?: RefCallback<HTMLDivElement>;
  className?: string;
  propertyKey: string;
  option: SelectOption;
  items: EnrichedContact[];
  showColor?: boolean;
  displayedProperties: Property[];
  useNewUnread: boolean;
  index?: number;
  style?: React.CSSProperties;
}>) {
  const { isSelectionMode, selectedContacts, setSelectedContacts } =
    useViewContext();

  const handleSelectContact = (contactId: string, checked: boolean) => {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(contactId);
      } else {
        next.delete(contactId);
      }
      return next;
    });
  };

  const { t } = useTranslation();
  const isNoValueColumn = option.value === NO_VALUE_OPTION.value;
  const sm = useBreakpoint("sm");

  const amountEnabled = useCurrentWorkspace(
    (w) => w.properties?.contacts?.some((p) => p.key === "amount") ?? false
  );

  const totalAmount = items.reduce(
    (acc, item) => acc + (Number(item.contact.amount) || 0),
    0
  );

  // remove column property because it's already displayed in the header
  const columnDisplayedProperties = displayedProperties.filter(
    (p) => p.key !== propertyKey
  );

  const scrollElementRef = useRef<HTMLDivElement>(null);
  const scrollRestorationId = `column-${option.value}`;
  const scrollEntry = useElementScrollRestoration({
    id: scrollRestorationId,
  });
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    initialOffset: scrollEntry?.scrollY,
    estimateSize: () => 70,
    overscan: 10,
    getItemKey: (index) => items[index]!.contact.id,
    paddingEnd: 16,
    scrollPaddingStart: 36,
    scrollPaddingEnd: 36,
  });

  const virtualItems = virtualizer.getVirtualItems();

  const workspaceId = useCurrentWorkspace((w) => w.id);
  const innerRef = useRef<HTMLDivElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const [scheduledScrollTo, setScheduledScrollTo] = useState<string>();
  const [highlightedContactId, setHighlightedContactId] = useState<string>();
  useEffect(() => {
    return dropTargetForElements({
      element: innerRef.current!,
      onDragEnter: ({ source }) => {
        const contactId = source.data.contactId;
        if (option.value === NO_VALUE_OPTION.value) return;
        if (!contactId) return;
        if (items.some((item) => item.contact.id === contactId)) return;
        setIsDraggedOver(true);
      },
      onDragLeave: () => setIsDraggedOver(false),
      onDrop: async ({ source }) => {
        const contactId = source.data.contactId as string;
        if (option.value === NO_VALUE_OPTION.value) return;
        if (!contactId) return;
        if (items.some((item) => item.contact.id === contactId)) return;
        await updateContact(workspaceId, contactId, {
          [propertyKey]: option.value,
        });
        setIsDraggedOver(false);
        setScheduledScrollTo(contactId);
      },
    });
  }, [items, option.value, propertyKey, virtualizer, workspaceId]);

  useEffect(() => {
    if (!scheduledScrollTo) return;
    virtualizer.scrollToIndex(
      items.findIndex((item) => item.contact.id === scheduledScrollTo),
      { behavior: items.length <= 30 ? "smooth" : "auto" }
    );
    setScheduledScrollTo(undefined);
    setHighlightedContactId(scheduledScrollTo);
  }, [scheduledScrollTo, virtualizer, items]);

  useEffect(() => {
    if (!highlightedContactId) return;
    const timer = setTimeout(() => {
      setHighlightedContactId(undefined);
    }, 1000);
    return () => clearTimeout(timer);
  }, [highlightedContactId]);

  const selectedCount = items.reduce(
    (acc, item) => acc + (selectedContacts.has(item.contact.id) ? 1 : 0),
    0
  );

  return (
    <div
      ref={(node) => {
        ref?.(node);
        innerRef.current = node;
      }}
      id={`column-${option.value}`}
      className={cn(
        "relative grid snap-start snap-always grid-rows-[auto_1fr] bg-gradient-to-b from-[hsl(var(--background-secondary))] to-transparent pt-2 sm:rounded-lg",
        className
      )}
      style={style}
      data-index={index}
    >
      <h3 className="mb-2 ml-3 hidden items-center gap-2 overflow-hidden px-2 text-base sm:flex">
        <ContactCardCheckbox
          visible={isSelectionMode}
          selected={
            selectedCount > 0
              ? selectedCount === items.length
                ? true
                : "indeterminate"
              : false
          }
          onSelect={(checked) =>
            setSelectedContacts((prev) => {
              const next = new Set(prev);
              for (const item of items) {
                if (checked) {
                  next.add(item.contact.id);
                } else {
                  next.delete(item.contact.id);
                }
              }
              return next;
            })
          }
        />
        {showColor && !isNoValueColumn && (
          <ColorBubble className="size-3 shrink-0" color={option.color} />
        )}
        <span
          className={cn(
            "truncate font-medium",
            isNoValueColumn && "text-muted-foreground italic"
          )}
        >
          {option.label}
        </span>
        <span className="text-muted-foreground">{items.length}</span>

        {amountEnabled && totalAmount > 0 && (
          <Badge variant="outline" className="bg-card ml-auto w-fit px-2">
            {formatCompactNumber(totalAmount)}
          </Badge>
        )}
      </h3>
      <ScrollAreaRoot className="flex h-auto min-h-0">
        <ScrollAreaViewport
          ref={scrollElementRef}
          data-scroll-restoration-id={scrollRestorationId}
        >
          {items.length === 0 && (
            <div className="text-muted-foreground/60 my-4 flex justify-center italic sm:hidden">
              {t("web.contacts.emptyList")}
            </div>
          )}
          <div
            className="relative w-full"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
            }}
          >
            <div
              className="divide-background absolute left-2 right-2 top-0 divide-y"
              style={{
                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                willChange: "transform",
              }}
            >
              {virtualItems.map((virtualItem) => {
                const item = items[virtualItem.index]!;
                return (
                  <ContactCardRoot
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    item={item}
                    className={cn(
                      highlightedContactId === item.contact.id &&
                        "!bg-badge-yellow/90 duration-1000"
                    )}
                    displayedProperties={columnDisplayedProperties}
                    useNewUnread={useNewUnread}
                    draggable={sm}
                    /*
                     * Use fixed element height on iOS to prevent stuttering
                     * with momentum scrolling.
                     * There are probably better ways to do this, but this is
                     * the easiest way to get it working for now.
                     */
                    ref={(node) => {
                      if (!isIOS) {
                        virtualizer.measureElement(node);
                      }
                    }}
                    style={{
                      height: isIOS ? virtualItem.size : undefined,
                    }}
                    onClick={(e) => {
                      if (isSelectionMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSelectContact(
                          item.contact.id,
                          !selectedContacts.has(item.contact.id)
                        );
                      }
                    }}
                  >
                    <ContactCardCheckbox
                      visible={isSelectionMode}
                      selected={selectedContacts.has(item.contact.id)}
                      onSelect={(checked) =>
                        handleSelectContact(item.contact.id, checked)
                      }
                    />
                    <ContactCardAvatar className="sm:size-8 sm:text-xs" />
                    <ContactCardContent />
                  </ContactCardRoot>
                );
              })}
            </div>
          </div>
        </ScrollAreaViewport>
      </ScrollAreaRoot>
      <AnimatePresence>
        {isDraggedOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-primary/20 absolute inset-0 rounded-t-lg"
          />
        )}
      </AnimatePresence>
    </div>
  );
}

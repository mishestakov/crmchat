import { useElementScrollRestoration } from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { ContactViewFilters } from "../contact-view-filters";
import {
  ContactCardAvatar,
  ContactCardCheckbox,
  ContactCardContent,
  ContactCardRoot,
} from "./contact-card";
import { SelectionActions } from "./selection-actions";
import { useViewContext } from "./view-context";
import { CreateContactArrow } from "@/components/create-contact-arrow";
import { ResponsivePage } from "@/components/mini-app-page";
import { Checkbox } from "@/components/ui/checkbox";
import { useDisplayedProperties } from "@/hooks/useProperties";
import { useCurrentWorkspace } from "@/lib/store";
import { isIOS } from "@/lib/utils";

export function ListView() {
  const { t } = useTranslation();

  const {
    items,
    useNewUnread,
    isLoading,
    hasActiveFilters,
    isSelectionMode,
    setIsSelectionMode,
    selectedContacts,
    setSelectedContacts,
  } = useViewContext();

  const workspaceId = useCurrentWorkspace((s) => s.id);

  useEffect(() => {
    setIsSelectionMode(false);
    setSelectedContacts(new Set());
  }, [setIsSelectionMode, setSelectedContacts, workspaceId]);

  const displayedProperties = useDisplayedProperties("contacts");

  const scrollEntry = useElementScrollRestoration({
    getElement: () => window,
  });

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

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 70,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    initialOffset: scrollEntry?.scrollY,
  });

  return (
    <ResponsivePage className="h-full w-full" size="narrow" helpButton={false}>
      <ContactViewFilters />

      <SelectionActions
        className="px-3 pb-2"
        checkbox={
          <Checkbox
            checked={
              selectedContacts.size === 0
                ? false
                : selectedContacts.size === items.length
                  ? true
                  : "indeterminate"
            }
            onCheckedChange={(checked: boolean) => {
              if (checked) {
                setSelectedContacts(
                  new Set(items.map((item) => item.contact.id))
                );
              } else {
                setSelectedContacts(new Set());
              }
            }}
          />
        }
      />

      <div ref={listRef}>
        <div
          className="divide-background w-full divide-y"
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]!;
            return (
              <ContactCardRoot
                key={virtualRow.key}
                data-index={virtualRow.index}
                item={item}
                displayedProperties={displayedProperties}
                useNewUnread={useNewUnread}
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
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: isIOS ? virtualRow.size : undefined,
                  transform: `translateY(${
                    virtualRow.start - virtualizer.options.scrollMargin
                  }px)`,
                }}
              >
                <ContactCardCheckbox
                  visible={isSelectionMode}
                  selected={selectedContacts.has(item.contact.id)}
                  onSelect={(checked) =>
                    handleSelectContact(item.contact.id, checked)
                  }
                />
                <ContactCardAvatar />
                <ContactCardContent />
              </ContactCardRoot>
            );
          })}
        </div>
      </div>
      {!isLoading && !hasActiveFilters && items.length < 4 && (
        <section className="mx-auto mt-12 flex max-w-xs grow flex-col items-center text-center">
          <h4 className="text-lg font-medium">
            {t("web.contacts.addMoreLeads")}
          </h4>
          <p className="text-muted-foreground">
            {t("web.contacts.keepGrowing")}
          </p>
          <CreateContactArrow />
        </section>
      )}
    </ResponsivePage>
  );
}

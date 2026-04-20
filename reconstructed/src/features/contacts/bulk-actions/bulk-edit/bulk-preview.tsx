import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { HTMLAttributes, Ref, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Property } from "@repo/core/types";

import { useBulkEditContext } from "./bulk-edit-context";
import { RenderPropertyValue } from "@/components/property-value-renderer";
import { Button } from "@/components/ui/button";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
} from "@/components/ui/scroll-area";
import { usePropertiesWithMetadata } from "@/hooks/useProperties";
import { useVirtualizer } from "@/hooks/virtualizer";
import { PropertyMetadata } from "@/lib/properties";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

export function BulkEditPreview() {
  const { t } = useTranslation();
  const [properties] = usePropertiesWithMetadata("contacts");
  const {
    workspaceId,
    contactIds,
    updateData,
    setStep,
    enqueueBulkUpdate,
    isEnqueueing,
  } = useBulkEditContext();

  const keys = Object.keys(updateData);
  const contactIdsArray = [...contactIds];
  const updateProperties = keys
    .map((key) => properties.find((p) => p.key === key))
    .filter((p): p is Property & { metadata: PropertyMetadata } => !!p);

  const scrollElementRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: contactIds.size,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 8 + 24 + updateProperties.length * 32,
    getItemKey: (index) => contactIdsArray[index] ?? index,
    overscan: 5,
  });

  const items = virtualizer.getVirtualItems();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("web.contacts.bulkEditDialog.title")}</DialogTitle>
        <DialogDescription>
          {t("web.contacts.bulkEditDialog.previewDescription")}
        </DialogDescription>
      </DialogHeader>

      <ScrollAreaRoot className="flex min-h-0 grow">
        <ScrollAreaViewport
          ref={scrollElementRef}
          className="h-auto min-h-0 w-full rounded-lg border"
        >
          <div
            className="relative w-full"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
            }}
          >
            <div
              className="divide-background absolute left-0 right-0 top-0 divide-y"
              style={{
                transform: `translateY(${items[0]?.start ?? 0}px)`,
                willChange: "transform",
              }}
            >
              {items.map((virtualRow) => (
                <PreviewItem
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  workspaceId={workspaceId}
                  contactId={contactIdsArray[virtualRow.index]!}
                  updateProperties={updateProperties}
                  updateData={updateData}
                />
              ))}
            </div>
          </div>
        </ScrollAreaViewport>
      </ScrollAreaRoot>

      <DialogFooter>
        <Button
          variant="card"
          onClick={() => setStep("form")}
          disabled={isEnqueueing}
          className="w-full"
        >
          {t("web.contacts.bulkEditDialog.backButton")}
        </Button>
        <Button
          className="w-full"
          disabled={isEnqueueing}
          onClick={async () => {
            try {
              await enqueueBulkUpdate();
              setStep("progress");
            } catch (error) {
              console.error("Error enqueuing bulk update", error);
              toast.error(t("web.common.error.somethingWentWrong"));
            }
          }}
        >
          {isEnqueueing ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            t("web.contacts.bulkEditDialog.submitButton")
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function PreviewItem({
  ref,
  workspaceId,
  contactId,
  updateProperties,
  updateData,
  className,
  ...props
}: {
  ref: Ref<HTMLDivElement | null>;
  workspaceId: string;
  contactId: string;
  updateProperties: Property[];
  updateData: Record<string, any>;
} & HTMLAttributes<HTMLDivElement>) {
  const contact = useWorkspacesStore(
    (store) => store.workspaceData[workspaceId]?.contactsById[contactId]
  );

  return (
    <div className={cn("group", className)} ref={ref} {...props}>
      <div className="bg-muted flex items-center gap-2 px-2 py-2 transition-colors">
        {contact ? (
          <>
            <ContactAvatar className="size-5 text-xs" contact={contact} />
            <span className="flex-1 truncate text-xs font-semibold">
              {contact.fullName}
            </span>
          </>
        ) : (
          "Unknown contact"
        )}
      </div>

      {/* Changes table */}
      <div className="divide-border/50 divide-y">
        {updateProperties.map((property) => (
          <div
            key={property.key}
            className="bg-card hover:bg-accent/5 grid grid-cols-[80px_1fr_auto_1fr] gap-2 px-2 py-2 text-xs leading-[22px] transition-colors md:grid-cols-[120px_1fr_auto_1fr]"
          >
            {/* Field name */}
            <div className="text-muted-foreground truncate font-medium">
              {property.name}
            </div>

            {/* From value */}
            <div className="min-w-0">
              <div className="block truncate">
                <RenderPropertyValue
                  property={property}
                  object={contact}
                  fallback={
                    <span className="text-muted-foreground/50 italic">
                      None
                    </span>
                  }
                />
              </div>
            </div>

            {/* Arrow separator */}
            <ChevronRightIcon className="text-muted-foreground/50 mx-1 mt-[5px] size-3 shrink-0" />

            {/* To value */}
            <div className="min-w-0">
              <div className="block truncate">
                <RenderPropertyValue
                  property={property}
                  object={updateData}
                  fallback={
                    <span className="text-muted-foreground/50 italic">
                      None
                    </span>
                  }
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

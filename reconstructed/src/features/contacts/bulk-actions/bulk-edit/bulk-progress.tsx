import { Link } from "@tanstack/react-router";
import { onSnapshot } from "firebase/firestore";
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { Ref, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BulkUpdateState } from "@repo/core/types";

import { useBulkEditContext } from "./bulk-edit-context";
import { AnimateChangeInHeight } from "@/components/animate-height";
import { Button } from "@/components/ui/button";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  ScrollAreaRoot,
  ScrollAreaViewport,
} from "@/components/ui/scroll-area";
import { useVirtualizer } from "@/hooks/virtualizer";
import { refs } from "@/lib/db";
import { useWorkspacesStore } from "@/lib/store/workspaces";

export function BulkEditProgress() {
  const { t } = useTranslation();
  const {
    workspaceId,
    contactIds,
    operationId,
    setCanCloseDialog,
    setIsCompleted,
  } = useBulkEditContext();

  const [state, setState] = useState<BulkUpdateState>();
  useEffect(() => {
    if (!operationId) return;

    return onSnapshot(refs.bulkUpdateState(workspaceId, operationId), (doc) => {
      setState(doc.data());
    });
  }, [workspaceId, operationId]);

  useEffect(() => {
    setCanCloseDialog(!!state?.completedAt);
    setIsCompleted(!!state?.completedAt);
  }, [state?.completedAt, setCanCloseDialog, setIsCompleted]);

  const processed =
    (state?.updatedCount ?? 0) + Object.keys(state?.errors ?? {}).length;
  const total = contactIds.size;

  return (
    <>
      <DialogHeader>
        {state?.completedAt ? (
          <>
            <DialogTitle className="flex items-center gap-2">
              {Object.keys(state?.errors ?? {}).length > 0 ? (
                <AlertCircleIcon className="size-5 text-yellow-600" />
              ) : (
                <CheckCircle2Icon className="size-5 text-green-600" />
              )}
              {t("web.contacts.bulkEditDialog.completedTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("web.contacts.bulkEditDialog.completedDescription")}
            </DialogDescription>
          </>
        ) : (
          <>
            <DialogTitle className="flex items-center gap-2">
              <Loader2Icon className="size-5 animate-spin" />
              {t("web.contacts.bulkEditDialog.updatingTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("web.contacts.bulkEditDialog.updatingDescription")}
            </DialogDescription>
          </>
        )}
      </DialogHeader>

      <div className="space-y-2">
        <Progress value={processed} max={total} className="h-3" />
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {t("web.contacts.bulkEditDialog.progress")}
          </span>
          <span className="font-medium">
            {processed} / {total}
          </span>
        </div>
      </div>

      <ErrorItems workspaceId={workspaceId} errors={state?.errors ?? {}} />

      <AnimateChangeInHeight>
        {state?.completedAt && (
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="card"
                className="flex w-full items-center justify-center gap-2"
              >
                {t("web.contacts.bulkEditDialog.completedButton")}
              </Button>
            </DialogClose>
          </DialogFooter>
        )}
      </AnimateChangeInHeight>
    </>
  );
}

function ErrorItems({
  workspaceId,
  errors,
}: {
  workspaceId: string;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const contactIds = Object.keys(errors);
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: contactIds.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => 40,
    overscan: 5,
  });
  const items = virtualizer.getVirtualItems();
  return (
    <div className="-mt-3 flex min-h-0">
      {contactIds.length === 0 ? null : (
        <div className="flex min-h-0 grow flex-col pt-3">
          <div className="text-destructive mb-2 text-xs font-medium">
            {t("web.contacts.bulkEditDialog.failedToUpdateSubtitle", {
              count: contactIds.length,
            })}
          </div>
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
                    <ErrorItem
                      key={virtualRow.key}
                      ref={virtualizer.measureElement}
                      data-index={virtualRow.index}
                      workspaceId={workspaceId}
                      contactId={contactIds[virtualRow.index]!}
                      error={errors[contactIds[virtualRow.index]!]!}
                    />
                  ))}
                </div>
              </div>
            </ScrollAreaViewport>
          </ScrollAreaRoot>
        </div>
      )}
    </div>
  );
}

function ErrorItem({
  workspaceId,
  contactId,
  ref,
  ...props
}: {
  workspaceId: string;
  contactId: string;
  error: string;

  className?: string;
  ref?: Ref<HTMLDivElement & HTMLAnchorElement>;
  "data-index": number;
}) {
  const contact = useWorkspacesStore(
    (s) => s.workspaceData[workspaceId]?.contactsById[contactId]
  );

  return (
    <Link
      ref={ref}
      {...props}
      to="/w/$workspaceId/contacts/$contactId"
      params={{ workspaceId, contactId }}
      target="_blank"
      className="bg-muted flex h-10 items-center gap-2 px-2 py-2 transition-colors"
    >
      {contact ? (
        <>
          <ContactAvatar className="size-5 text-xs" contact={contact} />
          <span className="flex-1 truncate text-xs font-semibold">
            {contact.fullName}
          </span>
        </>
      ) : (
        <span className="text-xs font-medium">Unknown contact</span>
      )}
    </Link>
  );
}

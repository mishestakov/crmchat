import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BulkEditContextProvider, BulkEditStep } from "./bulk-edit-context";
import { BulkEditForm } from "./bulk-form";
import { BulkEditPreview } from "./bulk-preview";
import { BulkEditProgress } from "./bulk-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const StepComponent = {
  form: BulkEditForm,
  preview: BulkEditPreview,
  progress: BulkEditProgress,
};

export function BulkEditDialog({
  workspaceId,
  contactIds,
  onComplete,
  disabled,
}: {
  workspaceId: string;
  contactIds: Set<string>;
  onComplete?: () => void;
  disabled?: boolean;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<BulkEditStep>("form");
  const [canCloseDialog, setCanCloseDialog] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [updateData, setUpdateData] = useState<Record<string, any>>({});

  const setSubscriptionsEnabled = useWorkspacesStore(
    (s) => s.setSubscriptionsEnabled
  );

  const {
    data: operation,
    mutateAsync,
    isPending,
  } = useMutation(trpc.contact.bulkUpdate.mutationOptions({}));

  const enqueueBulkUpdate = async () => {
    await mutateAsync({
      workspaceId,
      contactIds: [...contactIds],
      updateData,
    });
    setSubscriptionsEnabled(false);
  };

  const Component = StepComponent[step];

  const preventClose = (event: { preventDefault: () => void }) => {
    if (!canCloseDialog) {
      event.preventDefault();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isCompleted && !o) {
          setSubscriptionsEnabled(true);
          onComplete?.();
        }
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" variant="card" className="h-7" disabled={disabled}>
          {t("web.contacts.bulkEdit")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          "flex flex-col",
          (step === "preview" || step === "progress") &&
            "max-h-[calc(100svh-4rem)] overflow-hidden"
        )}
        showCloseButton={canCloseDialog}
        onPointerDownOutside={preventClose}
        onInteractOutside={preventClose}
        onEscapeKeyDown={preventClose}
      >
        <BulkEditContextProvider
          value={{
            workspaceId,
            contactIds,
            updateData,
            setUpdateData,
            step,
            setStep,
            setCanCloseDialog,
            setIsCompleted: (completed) => {
              setIsCompleted(completed);
              if (completed) {
                setSubscriptionsEnabled(true);
              }
            },
            enqueueBulkUpdate,
            isEnqueueing: isPending,
            operationId: operation?.operationId,
          }}
        >
          <Component />
        </BulkEditContextProvider>
      </DialogContent>
    </Dialog>
  );
}

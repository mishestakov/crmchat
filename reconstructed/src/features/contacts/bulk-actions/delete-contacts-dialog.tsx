import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTRPC } from "@/lib/trpc";

export function DeleteContactsDialog({
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const trpc = useTRPC();
  const { mutate, isPending } = useMutation(
    trpc.contact.deleteContacts.mutationOptions({
      onSuccess: () => {
        toast.info(
          t("web.contacts.deleteDialog.deletionSuccessToast", {
            count: contactIds.size,
          })
        );
        setOpen(false);
        onComplete?.();
      },
      onError: () => {
        toast.error(t("web.common.error.somethingWentWrong"));
      },
    })
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="xs"
          variant="card"
          className="5 hover:text-destructive h-7"
          disabled={disabled}
        >
          {t("web.contacts.deleteDialog.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("web.contacts.deleteDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("web.contacts.deleteDialog.description", {
              count: contactIds.size,
            })}
          </DialogDescription>
          <p className="text-destructive text-sm font-medium">
            {t("web.deleteWarning")}
          </p>
        </DialogHeader>
        <DialogFooter>
          <DestructiveButton
            enableTimeout={3000}
            showTimeLeft
            disabled={isPending}
            onClick={() => {
              mutate({
                workspaceId: workspaceId,
                contactIds: [...contactIds],
              });
            }}
          >
            {t("web.contacts.deleteDialog.deleteButton")}
          </DestructiveButton>
          <DialogClose asChild>
            <Button variant="card">{t("web.cancel")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

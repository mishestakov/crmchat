import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { moveContacts } from "@/lib/db/contacts";
import { useWorkspacesStore } from "@/lib/store/workspaces";

export function MoveContactsDialog({
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
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const [open, setOpen] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: (targetWorkspaceId: string) =>
      moveContacts(workspaceId, targetWorkspaceId, [...contactIds]),
    onSuccess: () => {
      setOpen(false);
      toast.success(t("web.contacts.movedSuccess"), {
        description: t("web.contacts.movedDescription", {
          count: contactIds.size,
        }),
      });
      onComplete?.();
    },
    onError: () => {
      toast.error(t("web.contacts.moveFailed"), {
        description: t("web.contacts.moveError"),
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="card" className="h-7" disabled={disabled}>
          {t("web.contacts.move")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("web.contacts.moveLeads")}</DialogTitle>
          <DialogDescription>
            {t("web.contacts.chooseWorkspace")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {workspaces.map((workspace) => (
            <Button
              key={workspace.id}
              variant="card"
              className="justify-start"
              disabled={isPending}
              onClick={() => mutate(workspace.id)}
            >
              {workspace.name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

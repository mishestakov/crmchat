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
import { useCurrentWorkspace } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { useTRPC } from "@/lib/trpc";

export function MoveTelegramAccountsDialog({
  workspaceId,
  accountIds,
  onComplete,
  disabled,
}: {
  workspaceId: string;
  accountIds: Set<string>;
  onComplete?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const organizationId = useCurrentWorkspace((s) => s.organizationId);
  const workspaces = useWorkspacesStore(
    (s) => s.workspacesByOrganizationId[organizationId] ?? []
  );
  const targetWorkspaces = workspaces.filter(
    (w) => w.id !== workspaceId && !w.excludeFromAccountBilling
  );
  const [open, setOpen] = useState(false);

  const { mutate, isPending } = useMutation(
    trpc.telegram.account.moveAccounts.mutationOptions({
      onSuccess: (_data, variables) => {
        setOpen(false);
        toast.success(
          t("web.outreach.telegramAccounts.moveSuccess", {
            count: variables.accountIds.length,
          })
        );
        onComplete?.();
      },
      onError: () => {
        toast.error(t("web.outreach.telegramAccounts.moveError"));
      },
    })
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="card" className="h-7" disabled={disabled}>
          {t("web.outreach.telegramAccounts.move")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("web.outreach.telegramAccounts.moveTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("web.outreach.telegramAccounts.moveDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {targetWorkspaces.length === 0 ? (
            <p className="text-destructive text-sm">
              {t("web.outreach.telegramAccounts.moveNoWorkspaces")}
            </p>
          ) : (
            targetWorkspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant="card"
                className="justify-start"
                disabled={isPending}
                onClick={() =>
                  mutate({
                    workspaceId,
                    accountIds: [...accountIds],
                    targetWorkspaceId: workspace.id,
                  })
                }
              >
                {workspace.name}
              </Button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

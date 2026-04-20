import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { group } from "radashi";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ContactCell } from "./contact-cell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TelegramLinkItem } from "@/features/outreach/sequences/telegram-link-item";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useWorkspaceStore } from "@/lib/store";
import { RouterOutput, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function DuplicateResolutionDialog({
  data,
}: {
  data: RouterOutput["outreach"]["getLeads"];
}) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigateBack = useNavigateBack();

  const duplicates = data.leads.filter(
    (lead) => lead.lead.stopReason === "duplicate"
  );

  const sequencesByListId = useWorkspaceStore((s) =>
    group(s.outreachSequences, (s) => s.listId)
  );
  const accountsById = useWorkspaceStore((s) => s.telegramAccountsById);
  const contactsById = useWorkspaceStore((s) => s.contactsById);

  const [actions, setActions] = useState<
    Record<string, "keep" | "remove" | undefined>
  >({});

  const allSelected =
    duplicates.length ===
    Object.values(actions).filter(
      (action) => action === "keep" || action === "remove"
    ).length;

  const queryClient = useQueryClient();
  const { mutate: resolveDuplicates, isPending: isResolvingDuplicates } =
    useMutation(
      trpc.outreach.resolveDuplicates.mutationOptions({
        onSuccess: () => {
          queryClient.invalidateQueries(trpc.outreach.getLeads.pathFilter());
        },
      })
    );

  const handleApply = () => {
    resolveDuplicates({
      workspaceId: data.workspaceId,
      sequenceId: data.sequenceId,
      actionsMap: actions as Record<string, "keep" | "remove">,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={() =>
        navigateBack({
          fallback: {
            to: "/w/$workspaceId/outreach/sequences/$id",
            params: { workspaceId: data.workspaceId, id: data.sequenceId },
          },
        })
      }
    >
      <DialogContent className="grid max-w-3xl md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {t("web.outreach.sequences.leads.duplicateResolution.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 md:hidden">
          <Button
            variant="card"
            size="xs"
            className="border"
            onClick={() =>
              setActions(
                Object.fromEntries(
                  duplicates.map((lead) => [lead.lead.id, "keep"])
                )
              )
            }
          >
            {t("web.outreach.sequences.leads.duplicateResolution.keepAll")}
          </Button>
          <Button
            variant="card"
            size="xs"
            className="border"
            onClick={() =>
              setActions(
                Object.fromEntries(
                  duplicates.map((lead) => [lead.lead.id, "remove"])
                )
              )
            }
          >
            {t("web.outreach.sequences.leads.duplicateResolution.removeAll")}
          </Button>
        </div>

        <div className="bg-card gap-2 overflow-y-auto rounded-lg px-2 py-2 text-sm md:py-0">
          {/* Table Header */}
          <div className="hidden grid-cols-12 border-b last:border-b-0 sm:col-span-12 sm:grid">
            <div className="col-span-3 flex items-center px-2 py-2 font-semibold">
              {t("web.outreach.sequences.leads.duplicateResolution.leadHeader")}
            </div>
            <div className="col-span-5 flex items-center px-2 py-2 font-semibold"></div>
            <div className="col-span-4 flex items-center gap-2 px-2 py-2 font-semibold">
              <Button
                variant="card"
                size="xs"
                className="border"
                onClick={() =>
                  setActions(
                    Object.fromEntries(
                      duplicates.map((lead) => [lead.lead.id, "keep"])
                    )
                  )
                }
              >
                {t("web.outreach.sequences.leads.duplicateResolution.keepAll")}
              </Button>
              <Button
                variant="card"
                size="xs"
                className="border"
                onClick={() =>
                  setActions(
                    Object.fromEntries(
                      duplicates.map((lead) => [lead.lead.id, "remove"])
                    )
                  )
                }
              >
                {t(
                  "web.outreach.sequences.leads.duplicateResolution.removeAll"
                )}
              </Button>
            </div>
          </div>
          {/* Table Body */}
          {duplicates.map((lead) => (
            <div
              key={lead.lead.id}
              className="grid grid-cols-1 items-start border-b last:border-b-0 sm:grid-cols-12"
            >
              <div className="px-2 py-3 sm:col-span-3">
                {lead.lead.username || lead.lead.phone ? (
                  <TelegramLinkItem
                    username={lead.lead.username}
                    phone={lead.lead.phone}
                  />
                ) : (
                  <ContactCell contactId={lead.lead.contactId!} />
                )}
              </div>
              {/* Duplicates */}
              <div className="flex flex-col gap-2 px-2 py-3 sm:col-span-5">
                {lead.lead.duplicates?.lists?.length && (
                  <div>
                    <div className="text-muted-foreground mb-1 block font-semibold">
                      {t(
                        "web.outreach.sequences.leads.duplicateResolution.sequenceDuplicates"
                      )}
                    </div>
                    <div>
                      {lead.lead.duplicates.lists.map(
                        (listId) =>
                          sequencesByListId[listId]?.map((s) => (
                            <div key={s.id}>
                              <Link
                                to="/w/$workspaceId/outreach/sequences/$id"
                                params={{
                                  workspaceId: data.workspaceId,
                                  id: s.id,
                                }}
                                target="_blank"
                                className="text-primary hover:underline"
                              >
                                {s.name}
                              </Link>
                            </div>
                          )) ??
                          t(
                            "web.outreach.sequences.leads.duplicateResolution.deletedSequence"
                          )
                      )}
                    </div>
                  </div>
                )}
                {lead.lead.duplicates?.contacts?.length && (
                  <div>
                    <div className="text-muted-foreground mb-1 block font-semibold">
                      {t(
                        "web.outreach.sequences.leads.duplicateResolution.contactsDuplicates"
                      )}
                    </div>
                    <div>
                      {lead.lead.duplicates.contacts.map((contactId) => (
                        <div key={contactId}>
                          <Link
                            to="/w/$workspaceId/contacts/$contactId"
                            params={{
                              workspaceId: data.workspaceId,
                              contactId,
                            }}
                            target="_blank"
                            className="text-primary hover:underline"
                          >
                            {contactsById[contactId]?.fullName ??
                              "Deleted lead"}
                          </Link>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {lead.lead.duplicates?.accounts?.length && (
                  <div>
                    <div className="text-muted-foreground mb-1 block font-semibold">
                      {t(
                        "web.outreach.sequences.leads.duplicateResolution.accountsDuplicates"
                      )}
                    </div>
                    <div>
                      {lead.lead.duplicates.accounts.map((accountId) => (
                        <div key={accountId}>
                          {accountsById[accountId] ? (
                            <>
                              {accountsById[accountId].telegram.fullName}
                              {accountsById[accountId].telegram.username && (
                                <>
                                  {" "}
                                  <span className="text-muted-foreground">
                                    •
                                  </span>{" "}
                                  @{accountsById[accountId].telegram.username}
                                </>
                              )}
                            </>
                          ) : (
                            `Deleted account`
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Action */}
              <div className="flex items-center px-2 py-3 sm:col-span-4">
                <Select
                  value={actions[lead.lead.id] ?? ""}
                  onValueChange={(value) =>
                    setActions({
                      ...actions,
                      [lead.lead.id]: value as "keep" | "remove",
                    })
                  }
                >
                  <SelectTrigger className="min-h-auto bg-card h-auto px-2 py-1">
                    <span
                      className={cn(
                        actions[lead.lead.id] === "keep" && "text-primary",
                        actions[lead.lead.id] === "remove" && "text-destructive"
                      )}
                    >
                      {actions[lead.lead.id] === "keep" &&
                        t(
                          "web.outreach.sequences.leads.duplicateResolution.keep"
                        )}
                      {actions[lead.lead.id] === "remove" &&
                        t(
                          "web.outreach.sequences.leads.duplicateResolution.remove"
                        )}
                      {actions[lead.lead.id] === undefined &&
                        t(
                          "web.outreach.sequences.leads.duplicateResolution.select"
                        )}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">
                      {t(
                        "web.outreach.sequences.leads.duplicateResolution.keep"
                      )}
                    </SelectItem>
                    <SelectItem value="remove">
                      {t(
                        "web.outreach.sequences.leads.duplicateResolution.remove"
                      )}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="card">
              {t(
                "web.outreach.sequences.leads.duplicateResolution.closeButton"
              )}
            </Button>
          </DialogClose>
          <Button
            disabled={!allSelected || isResolvingDuplicates}
            onClick={handleApply}
          >
            {t("web.outreach.sequences.leads.duplicateResolution.applyButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

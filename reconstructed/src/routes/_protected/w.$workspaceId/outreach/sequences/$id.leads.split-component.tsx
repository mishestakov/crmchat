import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { TFunction } from "i18next";
import {
  CheckCheckIcon,
  CheckIcon,
  CircleAlertIcon,
  EllipsisVerticalIcon,
  LucideIcon,
  MessageCircleReplyIcon,
  XIcon,
} from "lucide-react";
import { mapValues } from "radashi";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePhoneNumber } from "react-phone-number-input";

import { OutreachSequenceWithId } from "@repo/core/types";

import { Form } from "@/components/form/form";
import { ResponsivePage } from "@/components/mini-app-page";
import { DevSendMessageNow } from "@/components/outreach/_dev-send-message-now";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label, labelVariants } from "@/components/ui/label";
import Loader from "@/components/ui/loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tip } from "@/components/ui/tooltip";
import { ContactCell } from "@/features/outreach/sequences/contact-cell";
import { DuplicateResolutionDialog } from "@/features/outreach/sequences/duplicate-resolution-dialog";
import { TelegramLinkItem } from "@/features/outreach/sequences/telegram-link-item";
import { useAppForm } from "@/hooks/app-form";
import { useWorkspaceStore } from "@/lib/store";
import { RouterOutput, useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/$id/leads"
)({
  component: RouteComponent,
});

type Response = RouterOutput["outreach"]["getLeads"];
type ListData = Response["list"];
type LeadData = Response["leads"][number]["lead"];
type MessageData = Response["leads"][number]["messages"][number];

function RouteComponent() {
  const trpc = useTRPC();
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const sequence = useWorkspaceStore((s) => s.outreachSequencesById[id]);
  const list = useWorkspaceStore(
    (s) => s.outreachListsById[sequence?.listId ?? ""]
  );
  const accounts = useWorkspaceStore((s) =>
    mapValues(s.telegramAccountsById, (a) => ({
      id: a.id,
      telegram: a.telegram,
    }))
  );

  const { data, isPending, isError } = useQuery(
    trpc.outreach.getLeads.queryOptions(
      {
        workspaceId: sequence?.workspaceId ?? "",
        sequenceId: id,
      },
      {
        enabled: !!sequence,
        refetchInterval: false,
        refetchOnWindowFocus: false,
      }
    )
  );

  const [showCsvData, setShowCsvData] = useState(false);

  if (!sequence) {
    return null;
  }

  return (
    <ResponsivePage workspaceSelector={false}>
      <div className="m-3 flex items-center justify-between">
        <div className={labelVariants()}>
          {isPending
            ? t("web.loading")
            : t("web.outreach.sequences.leads.totalLeads", {
                count: data?.leads.length ?? 0,
              })}
        </div>
        {list?.source.type === "csvFile" && (
          <Label className="mx-3 flex items-center gap-2" variant="classic">
            <Checkbox
              checked={showCsvData}
              onCheckedChange={(checked) => setShowCsvData(checked === true)}
            />
            {t("web.outreach.sequences.leads.showCsvData")}
          </Label>
        )}
      </div>
      <div className="bg-card text-card-foreground mx-3 overflow-hidden rounded-lg">
        <Table className="min-w-max table-auto">
          <TableHeader>
            <TableRow>
              <TableHead className="bg-card sticky left-0">
                {t("web.outreach.sequences.leads.leadHeader")}
              </TableHead>
              {showCsvData &&
                data?.list.properties.map((property) => (
                  <TableHead
                    key={property}
                    className="max-w-60 truncate"
                    title={property}
                  >
                    {property}
                  </TableHead>
                ))}
              <TableHead>
                {t("web.outreach.sequences.leads.accountHeader")}
              </TableHead>
              {sequence.messages.map((message, index) => (
                <TableHead key={message.id} className="whitespace-nowrap">
                  {index === 0
                    ? t("web.outreach.sequences.leads.firstMessageHeader")
                    : t("web.outreach.sequences.leads.messageHeader", {
                        index: index + 1,
                      })}
                </TableHead>
              ))}
              <TableHead className="bg-card sticky right-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.leads.map(({ lead, accountId, messages }) => {
              const account = accounts[accountId ?? ""];
              return (
                <TableRow key={lead.id} className="group">
                  <TableCell
                    className={cn(
                      "bg-card sticky left-0",
                      lead.stopReason === "removed-by-user" &&
                        "text-muted-foreground line-through grayscale"
                    )}
                  >
                    {lead.username || lead.phone ? (
                      <TelegramLinkItem
                        username={lead.username}
                        phone={lead.phone}
                      />
                    ) : (
                      <ContactCell contactId={lead.contactId!} />
                    )}
                  </TableCell>
                  {showCsvData &&
                    data?.list.properties.map((property) => (
                      <TableCell
                        key={property}
                        className="truncate whitespace-pre"
                        title={lead.properties[property]}
                      >
                        {lead.properties[property]}
                      </TableCell>
                    ))}
                  <TableCell className="whitespace-nowrap text-xs">
                    {account?.telegram.fullName && (
                      <span>{account.telegram.fullName}</span>
                    )}
                    <div className="text-muted-foreground">
                      {account?.telegram.username
                        ? `@${account.telegram.username}`
                        : account?.telegram.phone
                          ? parsePhoneNumber(
                              `+${account.telegram.phone}`
                            )?.formatInternational()
                          : ""}
                    </div>
                  </TableCell>
                  {sequence.messages.map((message) => {
                    const messageData = messages[message.id];

                    if (!messageData) {
                      return <TableCell key={message.id}></TableCell>;
                    }

                    const renderStatus = () => {
                      if (
                        messageData.status === "pending" ||
                        messageData.status === "sending"
                      ) {
                        return (
                          <MessageStatus
                            status={messageData.status}
                            date={messageData.scheduledAt}
                            retryAttemptsLeft={messageData.retryAttemptsLeft}
                          />
                        );
                      }
                      if (messageData.status === "failed") {
                        return (
                          <MessageStatus
                            status="failed"
                            date={messageData.scheduledAt}
                          />
                        );
                      }
                      if (messageData.repliedAt) {
                        return (
                          <MessageStatus
                            status="replied"
                            date={messageData.repliedAt}
                          />
                        );
                      }
                      if (messageData.readAt) {
                        return (
                          <MessageStatus
                            status="read"
                            date={messageData.readAt}
                          />
                        );
                      }
                      if (messageData.sentAt) {
                        return (
                          <MessageStatus
                            status="sent"
                            date={messageData.sentAt}
                          />
                        );
                      }

                      return null;
                    };

                    return (
                      <TableCell
                        key={message.id}
                        className="whitespace-nowrap text-xs"
                      >
                        <Tip content={<MessageTip data={messageData} />}>
                          <div>
                            {renderStatus()}
                            {process.env.NODE_ENV === "development" && (
                              <DevSendMessageNow
                                workspaceId={sequence.workspaceId}
                                messageId={messageData.id}
                              />
                            )}
                          </div>
                        </Tip>
                      </TableCell>
                    );
                  })}
                  <TableCell className="bg-card sticky right-0 text-right">
                    <LeadActions
                      sequence={sequence}
                      lead={lead}
                      list={data?.list}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {isPending && (
          <div className="flex items-center justify-center p-4">
            <Loader className="size-4" />
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center gap-1 p-4 text-sm">
            <XIcon className="text-destructive size-4" />
            {t("web.outreach.sequences.leads.loadError")}
          </div>
        )}
      </div>
      {data?.requireDuplicateResolution && (
        <DuplicateResolutionDialog data={data} />
      )}
    </ResponsivePage>
  );
}

function MessageTip({ data }: { data: MessageData }) {
  const { t } = useTranslation();
  if (data.status === "failed") {
    return (
      <MessageStatus
        status="failed"
        date={data.scheduledAt}
        error={
          data.error ?? t("web.outreach.sequences.leads.status.unknownError")
        }
      />
    );
  }

  if (data.status === "pending") {
    return (
      <>
        <MessageStatus status="pending" date={data.scheduledAt} />
        {data.retryAttemptsLeft && data.retryAttemptsLeft > 0 && (
          <div className="text-foreground mt-3">
            <span className="text-yellow-600">
              {t("web.outreach.sequences.leads.status.firstAttemptFailed")}
            </span>
            :
            <br />
            {data.error ??
              t("web.outreach.sequences.leads.status.unknownError")}
            <br />
            <span className="text-muted-foreground text-xs">
              {t("web.outreach.sequences.leads.status.attemptsLeft", {
                count: data.retryAttemptsLeft,
              })}
            </span>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-2 text-xs">
      {data.sentAt && <MessageStatus status="sent" date={data.sentAt} />}
      {data.readAt && <MessageStatus status="read" date={data.readAt} />}
      {data.repliedAt && (
        <MessageStatus status="replied" date={data.repliedAt} />
      )}
    </div>
  );
}

const STATUS_MAP = (
  t: TFunction
): Record<
  "pending" | "sending" | "sent" | "read" | "replied" | "failed",
  { icon: LucideIcon | null; text: string; color: string }
> => ({
  pending: {
    icon: null,
    text: t("web.outreach.sequences.leads.status.scheduled"),
    color: "text-muted-foreground",
  },
  sending: {
    icon: null,
    text: t("web.outreach.sequences.leads.status.sending"),
    color: "text-muted-foreground",
  },
  sent: {
    icon: CheckIcon,
    text: t("web.outreach.sequences.leads.status.sent"),
    color: "text-green-600",
  },
  read: {
    icon: CheckCheckIcon,
    text: t("web.outreach.sequences.leads.status.read"),
    color: "text-green-600",
  },
  replied: {
    icon: MessageCircleReplyIcon,
    text: t("web.outreach.sequences.leads.status.replied"),
    color: "text-green-600",
  },
  failed: {
    icon: XIcon,
    text: t("web.outreach.sequences.leads.status.failed"),
    color: "text-destructive",
  },
});

function MessageStatus({
  status,
  date,
  error,
  retryAttemptsLeft,
}: {
  status: "pending" | "sending" | "sent" | "read" | "replied" | "failed";
  date: string;
  error?: string;
  retryAttemptsLeft?: number;
}) {
  const { t } = useTranslation();
  const { icon: Icon, text, color } = STATUS_MAP(t)[status];

  if (status === "pending" && retryAttemptsLeft && retryAttemptsLeft > 0) {
    return (
      <div>
        <div className={cn("flex items-center gap-1", color)}>
          <CircleAlertIcon className="size-3 text-yellow-600" /> {text}
        </div>
        <div>{format(new Date(date), "MMM d, HH:mm")}</div>
      </div>
    );
  }

  return (
    <div>
      <div className={cn("flex items-center gap-0.5", color)}>
        {Icon && <Icon className="size-3" />} {text}
      </div>
      <div>{error ?? format(new Date(date), "MMM d, HH:mm")}</div>
    </div>
  );
}

function LeadActions({
  sequence,
  lead,
  list,
}: {
  sequence: OutreachSequenceWithId;
  lead: LeadData;
  list: ListData;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const removeMutation = useMutation(
    trpc.outreach.removeLeadFromSequence.mutationOptions()
  );
  const [showConfirm, setShowConfirm] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const alreadyRemoved = lead.stopReason === "removed-by-user";
  if (alreadyRemoved) {
    return null;
  }

  return (
    <>
      <DropdownMenu onOpenChange={() => setShowConfirm(false)}>
        <DropdownMenuTrigger>
          <EllipsisVerticalIcon className="size-4" />
          <span className="sr-only">
            {t("web.outreach.sequences.leads.actionsSrOnly")}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setShowEditDialog(true)}>
            {t("web.outreach.sequences.leads.editAction")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="grid [grid-template-areas:'stack']"
            onClick={async (e) => {
              // eslint-disable-next-line unicorn/no-negated-condition
              if (!showConfirm) {
                e.preventDefault();
                setShowConfirm(true);
              } else {
                await removeMutation.mutateAsync({
                  workspaceId: sequence.workspaceId,
                  sequenceId: sequence.id,
                  leadId: lead.id,
                });
                await queryClient.invalidateQueries(
                  trpc.outreach.getLeads.pathFilter()
                );
                setShowConfirm(false);
              }
            }}
          >
            <span
              className={cn("[grid-area:stack]", showConfirm && "invisible")}
            >
              {t("web.outreach.sequences.leads.removeAction")}
            </span>
            <span
              className={cn(
                "text-destructive [grid-area:stack]",
                !showConfirm && "invisible"
              )}
            >
              {t("web.outreach.sequences.leads.confirmAction")}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {showEditDialog && (
        <OutreachLeadFormDialog
          lead={lead}
          list={list}
          onClose={() => setShowEditDialog(false)}
        />
      )}
    </>
  );
}

function OutreachLeadFormDialog({
  lead,
  list,
  onClose,
}: {
  lead: LeadData;
  list: ListData;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useMutation(
    trpc.outreach.updateLeadProperties.mutationOptions()
  );

  const form = useAppForm({
    defaultValues: lead.properties,
    onSubmit: async (data) => {
      await mutation.mutateAsync({
        workspaceId: list.workspaceId,
        leadId: lead.id,
        listId: list.id,
        properties: data.value,
      });
      onClose();
      await queryClient.invalidateQueries(trpc.outreach.getLeads.pathFilter());
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <Form form={form}>
          <DialogHeader>
            <DialogTitle>
              {t("web.outreach.sequences.leads.editLeadTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            {list.properties.map((property) => (
              <form.AppField
                name={property}
                children={(field) => (
                  <field.FormField label={property}>
                    <field.TextInput />
                  </field.FormField>
                )}
              />
            ))}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="card" disabled={mutation.isPending}>
                {t("web.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {t("web.outreach.sequences.leads.saveButton")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

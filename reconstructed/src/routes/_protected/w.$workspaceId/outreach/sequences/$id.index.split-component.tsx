import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Check,
  CheckCheck,
  ChevronRight,
  HelpCircleIcon,
  MessageCircleReply,
  Pause,
  Play,
  Plus,
  TriangleAlertIcon,
} from "lucide-react";
import { m } from "motion/react";
import { capitalize, isNullish } from "radashi";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { OutreachSequenceWithId } from "@repo/core/types";

import { MiniAppPage } from "@/components/mini-app-page";
import {
  FormOutreachMessage,
  OutreachMessageForm,
  OutreachMessageRenderer,
} from "@/components/outreach/outreach-message-form";
import { Timeline, TimelineItem } from "@/components/outreach/timeline-item";
import { SimpleForm } from "@/components/simple-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { TextVariablesProvider } from "@/components/ui/editor/plugins/text-variables/text-variables-context";
import Loader from "@/components/ui/loader";
import {
  Section,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { OutreachGuideModal } from "@/features/outreach/sequences/outreach-guide-modal";
import { SequenceAnalyticsDialog } from "@/features/outreach/sequences/sequence-analytics-dialog";
import { useTextVariables } from "@/features/outreach/sequences/use-text-variables";
import {
  useCanUseSequences,
  useHasReachedContactLimit,
} from "@/hooks/subscription";
import { orpc } from "@/lib/orpc";
import { useWorkspaceStore } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";
import { cn, generateId } from "@/lib/utils";

export const AnalyticsSearchSchema = z.object({
  period: z.enum(["7d", "30d", "90d", "custom"]).default("7d"),
  viewMode: z.enum(["sendDate", "eventDate"]).default("sendDate"),
  grouping: z.enum(["day", "week", "month"]).default("day"),
  customFrom: z.iso.datetime().optional(),
  customTo: z.iso.datetime().optional(),
});

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/sequences/$id/"
)({
  component: RouteComponent,
  validateSearch: z.object({
    analytics: AnalyticsSearchSchema.optional(),
  }),
});

function RouteComponent() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const { analytics } = Route.useSearch();
  const navigate = Route.useNavigate();

  const sequence = useWorkspaceStore((s) => s.outreachSequencesById[id]);
  const list = useWorkspaceStore((s) =>
    sequence ? s.outreachListsById[sequence.listId] : undefined
  );
  const isGroupsOutreach = list?.source.type === "crmGroups";
  const isListProcessing =
    list?.status === "pending" || list?.status === "processing";
  const isDuplicationResolutionNeeded = sequence?.duplicationResolutionNeeded;
  const hasReachedContactLimit = useHasReachedContactLimit();
  const canUseSequences = useCanUseSequences();

  const { mutateAsync: updateSequence } = useMutation(
    orpc.outreach.sequences.patch.mutationOptions()
  );

  const [editMessage, setEditMessage] = useState<FormOutreachMessage | null>(
    null
  );

  const variablesData = useTextVariables(list);
  const trpc = useTRPC();

  const { data: stats } = useQuery(
    trpc.outreach.getSequenceStats.queryOptions(
      {
        workspaceId: sequence?.workspaceId ?? "",
        sequenceId: sequence?.id ?? "",
      },
      {
        enabled: !!sequence,
        refetchOnWindowFocus: false,
        refetchInterval: false,
        refetchOnReconnect: false,
      }
    )
  );
  const updateSequenceStatus = useMutation(
    trpc.outreach.updateSequenceStatus.mutationOptions()
  );
  if (!sequence || !list) {
    return null;
  }

  return (
    <MiniAppPage className="flex flex-col gap-4" workspaceSelector={false}>
      <SimpleForm
        label={t("web.outreach.sequences.index.nameLabel")}
        value={sequence.name}
        valueSchema={z.string().min(1)}
        onSubmit={async (name) => {
          await updateSequence({
            params: { workspaceId: sequence.workspaceId, sequenceId: id },
            body: { name },
          });
        }}
        children={(field) => <field.TextInput className="font-medium" />}
      />

      <Section>
        <SectionItems>
          <SectionItem asChild icon={null} className="hover:bg-card py-0">
            <div>
              <SectionItemTitle className="flex flex-col py-3">
                <div>{t("web.outreach.sequences.index.statusLabel")}</div>
                <span className="text-muted-foreground font-normal">
                  {t(
                    `web.outreach.sequences.status.${sequence.status}`,
                    capitalize(sequence.status)
                  )}
                </span>
              </SectionItemTitle>
              <SectionItemValue className="text-foreground font-normal">
                {sequence.status === "active" ? (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      updateSequenceStatus.mutate({
                        workspaceId: sequence.workspaceId,
                        sequenceId: id,
                        status: "paused",
                      })
                    }
                    disabled={updateSequenceStatus.isPending}
                  >
                    <Pause className="mr-1 size-4" />
                    {t("web.outreach.sequences.index.pauseSequenceButton")}
                  </Button>
                ) : (
                  sequence.status !== "completed" && (
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        if (hasReachedContactLimit) {
                          toast(t("web.contacts.limitReached"), {
                            action: {
                              label: t("web.contacts.upgrade"),
                              onClick: () =>
                                navigate({
                                  to: "/w/$workspaceId/settings/subscription",
                                  params: {
                                    workspaceId: sequence.workspaceId,
                                  },
                                  search: { minPlan: "pro" },
                                }),
                            },
                          });
                          return;
                        }
                        updateSequenceStatus.mutate({
                          workspaceId: sequence.workspaceId,
                          sequenceId: id,
                          status: "active",
                        });
                      }}
                      disabled={
                        isDuplicationResolutionNeeded ||
                        isListProcessing ||
                        updateSequenceStatus.isPending ||
                        !canUseSequences
                      }
                    >
                      <Play className="mr-1 size-4" />
                      {t("web.outreach.sequences.index.startSequenceButton")}
                    </Button>
                  )
                )}
              </SectionItemValue>
            </div>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./accounts">
              <SectionItemTitle>
                {t("web.outreach.sequences.index.accountsLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                {(sequence.accounts?.mode ?? "all") === "all" ? (
                  t("web.outreach.sequences.index.allAccounts")
                ) : (
                  <SelectedAccountsCount
                    ids={sequence.accounts?.selected ?? []}
                  />
                )}
              </SectionItemValue>
            </Link>
          </SectionItem>
          <SectionItem asChild>
            <Link from={Route.fullPath} to="./contact-settings">
              <SectionItemTitle>
                {t("web.outreach.sequences.crmSettings.title")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
          <SectionItem
            asChild
            icon={isListProcessing ? <Loader className="size-4" /> : undefined}
          >
            <Link from={Route.fullPath} to="./leads">
              <SectionItemTitle>
                {t("web.outreach.sequences.index.leadsLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                {sequence.duplicationResolutionNeeded && (
                  <TriangleAlertIcon className="size-4 text-yellow-500" />
                )}
                {isListProcessing
                  ? t("web.outreach.sequences.index.listProcessing")
                  : t("web.outreach.sequences.index.listSize", {
                      count: list.totalSize,
                    })}
              </SectionItemValue>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>

      {sequence.status !== "draft" && (
        <SequenceAnalyticsDialog
          workspaceId={sequence.workspaceId}
          sequenceId={sequence.id}
          params={analytics}
          onParamsChange={(params) =>
            navigate({
              search: (prev) => ({ ...prev, analytics: params }),
              replace: true,
              viewTransition: false,
            })
          }
        >
          <button type="button" className="group w-full text-left">
            <div className="text-muted-foreground mx-3 mb-1 flex items-center justify-between text-xs uppercase">
              <span>{t("web.outreach.sequences.index.statsHeader")}</span>
              <span className="-mr-0.5 flex items-center gap-1.5">
                <Badge
                  variant="outline"
                  className="text-muted-foreground group-hover:border-primary font-normal normal-case"
                >
                  {t("web.outreach.sequences.index.statsViewMore")}
                </Badge>
                <ChevronRight className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-2">
              <StatsCard
                loading={!stats}
                icon={Check}
                label={t("web.outreach.sequences.index.stats.sent")}
                value={stats?.sent ?? 0}
              />
              {!isGroupsOutreach && (
                <>
                  <StatsCard
                    loading={!stats}
                    icon={CheckCheck}
                    label={t("web.outreach.sequences.index.stats.read")}
                    value={stats?.read ?? 0}
                    total={stats?.sent ?? 0}
                  />
                  <StatsCard
                    loading={!stats}
                    icon={MessageCircleReply}
                    label={t("web.outreach.sequences.index.stats.replied")}
                    value={stats?.replied ?? 0}
                    total={stats?.sent ?? 0}
                  />
                </>
              )}
            </div>
          </button>
        </SequenceAnalyticsDialog>
      )}

      <TextVariablesProvider
        value={{
          list,
          variables: variablesData.variables,
          notDefinedVariables: variablesData.notDefined.map,
          notDefinedVariablesPending: variablesData.notDefined.isPending,
        }}
      >
        <Section>
          <div className="flex items-center justify-between">
            <SectionHeader className="mb-0">
              {t("web.outreach.sequences.index.sequenceHeader")}
            </SectionHeader>
            <OutreachGuideModal>
              <Button variant="ghost" className="outreach-guide-button size-8">
                <HelpCircleIcon className="size-4" />
                <span className="sr-only">Outreach checklist</span>
              </Button>
            </OutreachGuideModal>
          </div>

          <Timeline>
            {sequence.messages.map((message, index) => (
              <Fragment key={message.id}>
                {editMessage?.id === message.id ? (
                  <OutreachMessageForm
                    initialValue={editMessage}
                    onSubmit={async (v) => {
                      await updateSequence({
                        params: {
                          workspaceId: sequence.workspaceId,
                          sequenceId: id,
                        },
                        body: {
                          messages: sequence.messages.map((m) =>
                            m.id === v.id ? { ...v, id: m.id } : m
                          ),
                        },
                      });
                      setEditMessage(null);
                    }}
                    onCancel={() => setEditMessage(null)}
                    onDelete={async () => {
                      await updateSequence({
                        params: {
                          workspaceId: sequence.workspaceId,
                          sequenceId: id,
                        },
                        body: {
                          messages: sequence.messages.filter(
                            (m) => m.id !== message.id
                          ),
                        },
                      });
                      setEditMessage(null);
                    }}
                    firstMessage={index === 0}
                    sequenceId={id}
                    workspaceId={sequence.workspaceId}
                  />
                ) : (
                  <OutreachMessageRenderer
                    key={sequence.updatedAt.toDate().getTime()}
                    className={cn(
                      "transition-opacity",
                      !!editMessage && "opacity-40 dark:opacity-30"
                    )}
                    value={message}
                    firstMessage={index === 0}
                    onClick={
                      editMessage
                        ? undefined
                        : () => {
                            if (sequence.status === "active") {
                              toast(
                                t(
                                  "web.outreach.sequences.index.activeSequenceToastTitle"
                                ),
                                {
                                  description: t(
                                    "web.outreach.sequences.index.activeSequenceToastDescription"
                                  ),
                                }
                              );
                              return;
                            }
                            setEditMessage(message);
                          }
                    }
                    stats={stats?.messageStats[message.id]}
                    isGroupsOutreach={isGroupsOutreach}
                  />
                )}
              </Fragment>
            ))}

            {editMessage && editMessage.id === null ? (
              <OutreachMessageForm
                initialValue={editMessage}
                onCancel={() => setEditMessage(null)}
                onSubmit={async (v) => {
                  await updateSequence({
                    params: {
                      workspaceId: sequence.workspaceId,
                      sequenceId: id,
                    },
                    body: {
                      messages: [
                        ...sequence.messages,
                        { ...v, id: generateId() },
                      ],
                    },
                  });
                  setEditMessage(null);
                }}
                firstMessage={sequence.messages.length === 0}
                sequenceId={id}
                workspaceId={sequence.workspaceId}
              />
            ) : (
              (!isGroupsOutreach || sequence.messages.length === 0) && (
                <TimelineItem
                  asChild
                  className={cn(
                    "transition-opacity",
                    !!editMessage && "opacity-40 dark:opacity-30"
                  )}
                  icon={<Plus className="size-4" />}
                  header={
                    sequence.messages.length === 0
                      ? t("web.outreach.sequences.index.addFirstMessage")
                      : t("web.outreach.sequences.index.addMessage")
                  }
                  onClick={
                    editMessage
                      ? undefined
                      : () => {
                          if (sequence.status === "active") {
                            toast(
                              t(
                                "web.outreach.sequences.index.activeSequenceToastTitle"
                              ),
                              {
                                description: t(
                                  "web.outreach.sequences.index.activeSequenceToastDescription"
                                ),
                              }
                            );
                            return;
                          }
                          setEditMessage({
                            id: null,
                            delay: {
                              period: "days",
                              value: 1,
                            },
                            type: "text",
                            text: "",
                          });
                        }
                  }
                >
                  <m.div layoutId="new" />
                </TimelineItem>
              )
            )}
          </Timeline>
        </Section>
      </TextVariablesProvider>

      <div className="mt-auto py-3 text-center">
        <DeleteSequenceDialog sequence={sequence} />
      </div>
    </MiniAppPage>
  );
}

function StatsCard({
  loading,
  icon: Icon,
  label,
  value,
  total,
}: {
  loading?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  total?: number;
}) {
  return (
    <div
      className={cn(
        "bg-card rounded-lg px-3 py-2 transition-colors",
        loading && "animate-pulse"
      )}
    >
      <div
        className={cn(
          "transition-opacity duration-700",
          loading && "opacity-0"
        )}
      >
        <div className="text-muted-foreground flex items-center gap-1 text-sm">
          {loading ? (
            <>&nbsp;</>
          ) : (
            <>
              {Icon && <Icon className="size-3 shrink-0" />} {label}
            </>
          )}
        </div>
        <div className="mt-0.5 flex items-end gap-2 text-2xl font-medium">
          {loading ? (
            <>&nbsp;</>
          ) : (
            <>
              {value}
              {!isNullish(total) && (
                <span className="text-muted-foreground pb-0.5 text-sm">
                  {total > 0 ? Math.round((value / total) * 100) : 0}%
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedAccountsCount({ ids }: { ids: string[] }) {
  const isLoading = useWorkspaceStore((s) => s.telegramAccountsLoading);
  const count = useWorkspaceStore(
    (s) => ids.filter((id) => s.telegramAccountsById[id]).length
  );
  if (isLoading) {
    return null;
  }
  return count;
}

function DeleteSequenceDialog({
  sequence,
  className,
}: {
  sequence: OutreachSequenceWithId;
  className?: string;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useMutation(
    orpc.outreach.sequences.delete.mutationOptions()
  );

  return (
    <Drawer>
      <DrawerTrigger
        asChild
        className={cn(
          "text-muted-foreground hover:text-destructive text-sm transition-colors",
          className
        )}
      >
        <Button
          variant="link"
          onClick={(e) => {
            if (sequence.status === "active") {
              e.preventDefault();
              e.stopPropagation();
              toast(
                t("web.outreach.sequences.index.activeSequenceToastTitle"),
                {
                  description: t(
                    "web.outreach.sequences.index.activeSequenceDeleteToastDescription"
                  ),
                }
              );
              return;
            }
          }}
        >
          {t("web.outreach.sequences.index.deleteSequenceButton")}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.deleteConfirmTitle")}</DrawerTitle>
          <DrawerDescription asChild>
            <div>
              <p className="mt-2">
                {t("web.outreach.sequences.index.deleteConfirmDescription")}
              </p>
              <p className="text-destructive mt-2">
                <strong>{t("web.deleteWarning")}</strong>
              </p>
            </div>
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton
            disabled={isPending}
            enableTimeout={500}
            onClick={async () => {
              await mutateAsync({
                workspaceId: sequence.workspaceId,
                sequenceId: sequence.id,
              });
              navigate({
                to: "/w/$workspaceId/outreach",
                params: { workspaceId: sequence.workspaceId },
                replace: true,
              });
            }}
          >
            {t("web.outreach.sequences.index.deleteSequenceButton")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="outline" className="w-full">
              {t("web.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

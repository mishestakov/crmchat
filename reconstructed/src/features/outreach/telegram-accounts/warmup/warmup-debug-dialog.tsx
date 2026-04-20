import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleMinusIcon,
  CircleXIcon,
  ClockIcon,
  Loader2Icon,
  PlayIcon,
} from "lucide-react";
import { group } from "radashi";
import { useEffect, useState } from "react";

import {
  TelegramAccountWithId,
  WarmupSessionAction,
  WarmupSessionWithId,
} from "@repo/core/types";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { subscribeToLatestWarmupSessions } from "@/lib/db/telegram";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function WarmupDebugDialog({
  onOpenChange,
  account,
}: {
  onOpenChange: (open: boolean) => void;
  account: TelegramAccountWithId;
}) {
  const trpc = useTRPC();

  const triggerWarmupSession = useMutation(
    trpc.telegram.account.triggerWarmupSession.mutationOptions()
  );

  const [sessions, setSessions] = useState<WarmupSessionWithId[]>([]);

  useEffect(() => {
    return subscribeToLatestWarmupSessions(
      account.workspaceId,
      account.id,
      (snapshot) => {
        setSessions(
          snapshot.docs.map((doc) => ({
            ...doc.data(),
            id: doc.id,
          })) as WarmupSessionWithId[]
        );
      }
    );
  }, [account.workspaceId, account.id]);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        position="top"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Warmup Sessions Debug</DialogTitle>
          <DialogDescription>
            Most recent warmup sessions and their actions
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto pr-2">
          {sessions.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">
              No warmup sessions found
            </div>
          ) : (
            <Accordion type="multiple" className="w-full space-y-4">
              {Object.entries(
                group(sessions, (s) =>
                  format(s.executionDate.toDate(), "yyyy-MM-dd")
                )
              ).map(([dateKey, groupSessions]) => (
                <div key={dateKey} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-muted-foreground px-1 py-1 text-xs font-medium uppercase tracking-wider">
                      {format(new Date(dateKey), "EEEE, MMMM d")}
                    </div>
                    <Badge variant="default">{groupSessions?.[0]?.stage}</Badge>
                  </div>
                  {groupSessions?.map((session) => (
                    <AccordionItem
                      key={session.id}
                      value={session.id}
                      className="rounded-lg border px-2"
                    >
                      <AccordionTrigger className="gap-2 py-2 hover:no-underline">
                        <div className="flex w-full items-center gap-3 text-left">
                          <SessionStatusIcon
                            status={session.status}
                            className="size-4"
                          />
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {format(session.executionDate.toDate(), "p")}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {session.actions?.length ?? 0} actions
                            </span>
                          </div>

                          <Button
                            variant="outline"
                            size="xs"
                            className={cn(
                              "ml-auto mr-1 size-6 gap-1",
                              session.status !== "pending" && "invisible"
                            )}
                            disabled={
                              session.status !== "pending" ||
                              triggerWarmupSession.isPending
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                confirm(
                                  "Are you sure you want to trigger this session now?"
                                )
                              ) {
                                triggerWarmupSession.mutate({
                                  workspaceId: session.workspaceId,
                                  sessionId: session.id,
                                });
                              }
                            }}
                          >
                            <PlayIcon className="size-3" />
                          </Button>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <Accordion type="multiple" className="w-full px-1">
                          {session.actions.map((action) => (
                            <ActionItem key={action.id} action={action} />
                          ))}
                        </Accordion>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </div>
              ))}
            </Accordion>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionItem({ action }: { action: WarmupSessionAction }) {
  return (
    <AccordionItem
      value={action.id}
      className="border-b-0 bg-transparent hover:bg-transparent"
    >
      <AccordionTrigger className="hover:bg-muted py-2 transition-none hover:no-underline">
        <div className="flex items-center gap-2 font-medium">
          <ActionStatusIcon status={action.status} className="size-4" />
          <span>{action.type}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
          <div className="grid grid-cols-[80px_1fr] gap-2">
            <span className="text-muted-foreground">Status:</span>
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
              {action.status}
            </pre>
          </div>
          {Boolean(action.params) && (
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <span className="text-muted-foreground">Params:</span>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(action.params, null, 2)}
              </pre>
            </div>
          )}
          {Boolean(action.result) && (
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <span className="text-muted-foreground">Result:</span>
              <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(action.result, null, 2)}
              </pre>
            </div>
          )}
          {action.error && (
            <div className="text-destructive grid grid-cols-[80px_1fr] gap-2">
              <span>Error:</span>
              <span className="text-xs">{action.error}</span>
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function SessionStatusIcon({
  status,
  className,
}: {
  status: WarmupSessionWithId["status"];
  className?: string;
}) {
  switch (status) {
    case "pending":
      return <ClockIcon className={cn("text-muted-foreground", className)} />;
    case "running":
      return (
        <Loader2Icon className={cn("animate-spin text-blue-500", className)} />
      );
    case "completed":
      return <CheckIcon className={cn("text-green-500", className)} />;
    case "failed":
      return <CircleXIcon className={cn("text-red-500", className)} />;
  }
}

function ActionStatusIcon({
  status,
  className,
}: {
  status: WarmupSessionAction["status"];
  className?: string;
}) {
  switch (status) {
    case "pending":
      return <ClockIcon className={cn("text-muted-foreground", className)} />;
    case "completed":
      return <CircleCheckIcon className={cn("text-green-500", className)} />;
    case "failed":
      return <CircleXIcon className={cn("text-red-500", className)} />;
    case "skipped":
      return <CircleMinusIcon className={cn("text-blue-500", className)} />;
  }
}

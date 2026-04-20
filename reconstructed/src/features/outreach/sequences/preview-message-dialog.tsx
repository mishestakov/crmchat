import { useQuery } from "@tanstack/react-query";
import { DicesIcon } from "lucide-react";
import { PropsWithChildren, Suspense, use, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatUsername } from "@repo/core/utils";
import { formatMessageAsHtml } from "@repo/message-formatter";

import { useTextVariables } from "./use-text-variables";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import Loader from "@/components/ui/loader";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStore } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export function MessagePreviewDialog({
  children,
  messageText,
  sequenceId,
  workspaceId,
}: PropsWithChildren<{
  messageText: string;
  sequenceId: string;
  workspaceId: string;
}>) {
  const { t } = useTranslation();
  const trpc = useTRPC();

  const [open, setOpen] = useState(false);
  const { data, isPending } = useQuery(
    trpc.outreach.getLeads.queryOptions(
      { workspaceId, sequenceId },
      {
        enabled: open,
        refetchOnWindowFocus: false,
      }
    )
  );

  const [_selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const selectedLeadId = _selectedLeadId ?? data?.leads[0]?.lead.id;
  const selectedLead = data?.leads.find((l) => l.lead.id === selectedLeadId);

  const sequence = useWorkspaceStore(
    (state) => state.outreachSequencesById[sequenceId]
  );
  const list = useWorkspaceStore(
    (state) => state.outreachListsById[sequence?.listId ?? ""]
  );
  const textVariables = useTextVariables(list);

  // Build variables for substitution
  const previewHtml = useMemo(() => {
    const asVariableTag = (text: string) =>
      `<span class="text-orange-500">{{${text}}}</span>`;

    const variables: Record<string, string> = {
      ...Object.fromEntries(
        textVariables.variables.map((v) => [v.variable, asVariableTag(v.label)])
      ),
      ...selectedLead?.lead.properties,
      username: formatUsername(selectedLead?.lead.username) ?? "",
    };

    return formatMessageAsHtml(messageText, variables, selectedLeadId ?? "");
  }, [
    messageText,
    selectedLeadId,
    selectedLead?.lead.properties,
    selectedLead?.lead.username,
    textVariables.variables,
  ]);

  const getLeadDisplayName = (
    lead: NonNullable<typeof data>["leads"][number]["lead"]
  ) => {
    if (lead.username) return `@${lead.username}`;
    if (lead.phone) return lead.phone;
    return lead.id.slice(0, 8);
  };

  const randomizeLead = () => {
    let attempts = 5;
    let leadId =
      data?.leads[Math.floor(Math.random() * data.leads.length)]?.lead.id;
    while (attempts > 0 && leadId === selectedLeadId) {
      leadId =
        data?.leads[Math.floor(Math.random() * data.leads.length)]?.lead.id;
      attempts--;
    }
    if (!leadId) {
      return;
    }
    setSelectedLeadId(leadId ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent position="top" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("web.outreach.sequences.preview.title")}</DialogTitle>
        </DialogHeader>

        <div className="mt-3 space-y-4">
          <div>
            <Label className="mb-2 block">
              {t("web.outreach.sequences.preview.loadDataForLead")}
            </Label>
            {isPending ? (
              <div className="flex items-center gap-2 py-2">
                <Loader className="size-4" />
                <span className="text-muted-foreground text-sm">
                  {t("web.loading")}
                </span>
              </div>
            ) : data?.leads.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t("web.outreach.sequences.preview.noLeads")}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <Select
                  value={selectedLeadId}
                  onValueChange={(leadId) => setSelectedLeadId(leadId)}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t(
                        "web.outreach.sequences.preview.selectLead"
                      )}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {data?.leads.map(({ lead }) => (
                        <SelectItem key={lead.id} value={lead.id}>
                          {getLeadDisplayName(lead)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  className="border"
                  variant="card"
                  onClick={() => randomizeLead()}
                >
                  <DicesIcon className="size-4" />
                  {t("web.outreach.sequences.preview.randomize")}{" "}
                </Button>
              </div>
            )}
          </div>

          <div className="bg-card text-card-foreground rounded-lg p-4">
            <Suspense
              fallback={
                <p className="text-muted-foreground text-sm">
                  {t("web.loading")}
                </p>
              }
            >
              <PreviewContent previewHtml={previewHtml} />
            </Suspense>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="card">{t("web.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewContent({ previewHtml }: { previewHtml: Promise<string> }) {
  const html = use(previewHtml);
  return (
    <div
      className="[&_a]:text-primary text-sm [&_a]:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

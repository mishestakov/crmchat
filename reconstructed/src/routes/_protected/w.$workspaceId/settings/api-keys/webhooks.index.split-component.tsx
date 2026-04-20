import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { WebhookEventTypeSchema } from "@repo/core/types";

import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyableInput } from "@/components/ui/copiable-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Loader from "@/components/ui/loader";
import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItems,
} from "@/components/ui/section";
import { useAppForm } from "@/hooks/app-form";
import { useCurrentWorkspace } from "@/lib/store";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/api-keys/webhooks/"
)({
  component: WebhooksPage,
});

const WEBHOOK_EVENTS = WebhookEventTypeSchema.options;

function getErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  try {
    const parsed = JSON.parse(error.message);
    if (Array.isArray(parsed) && parsed[0]?.message) {
      return parsed[0].message;
    }
  } catch {
    // not JSON, use as-is
  }
  return error.message;
}

const createWebhookSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  url: z.url().refine((u) => u.startsWith("https://"), {
    message: "URL must start with https://",
  }),
  events: z.array(WebhookEventTypeSchema).min(1),
  workspaceIds: z.array(z.string().min(1)).min(1),
});

function WebhooksPage() {
  return (
    <MiniAppPage className="flex flex-col gap-6">
      <WebhookList />
    </MiniAppPage>
  );
}

function WebhookList() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const { data: webhooks, isPending } = useQuery(
    trpc.webhook.list.queryOptions()
  );

  return (
    <Section>
      <SectionHeader>{t("web.webhooks.title")}</SectionHeader>
      {isPending ? (
        <div className="m-3 text-center">
          <Loader />
        </div>
      ) : (
        <SectionItems>
          {webhooks?.map((webhook) => (
            <SectionItem key={webhook.id} asChild>
              <Link
                to="/w/$workspaceId/settings/api-keys/webhooks/$webhookId"
                params={{ workspaceId, webhookId: webhook.id }}
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <SectionItemTitle>
                    {webhook.name}
                    {webhook.status === "disabled" && (
                      <span className="text-muted-foreground ml-1 font-normal">
                        ({t("web.webhooks.status.disabled")})
                      </span>
                    )}
                  </SectionItemTitle>
                  <div className="text-muted-foreground truncate font-mono text-xs">
                    {webhook.url}
                  </div>
                </div>
              </Link>
            </SectionItem>
          ))}
          <CreateWebhookDialog />
        </SectionItems>
      )}
      <SectionDescription>{t("web.webhooks.description")}</SectionDescription>
    </Section>
  );
}

function CreateWebhookDialog() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const currentWorkspaceId = useCurrentWorkspace((state) => state.id);
  const allWorkspaces = useWorkspacesStore((state) => state.workspaces);

  const [open, setOpen] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const { mutateAsync: createWebhook } = useMutation(
    trpc.webhook.create.mutationOptions()
  );

  const form = useAppForm({
    defaultValues: {
      name: "Webhook",
      url: "",
      events: [] as z.infer<typeof createWebhookSchema>["events"],
      workspaceIds: [currentWorkspaceId],
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: createWebhookSchema,
    },
    onSubmit: async (e) => {
      try {
        const data = createWebhookSchema.parse(e.value);
        const result = await createWebhook(data);
        setCreatedSecret(result.signingSecret);
        queryClient.invalidateQueries(trpc.webhook.list.pathFilter());
      } catch (error) {
        const message = getErrorMessage(error) ?? t("web.webhooks.createError");
        toast.error(message);
      }
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      form.reset();
      setCreatedSecret(null);
    }
  };

  return (
    <>
      <SectionItem
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="text-muted-foreground mx-0.5 size-4" />
        <SectionItemTitle className="mr-auto">
          {t("web.webhooks.createButton")}
        </SectionItemTitle>
      </SectionItem>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {createdSecret ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("web.webhooks.createdTitle")}</DialogTitle>
                <DialogDescription>
                  {t("web.webhooks.secretWarning")}{" "}
                  {t("web.webhooks.secretHint")}
                </DialogDescription>
              </DialogHeader>
              <CopyableInput value={createdSecret} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button className="w-full">{t("web.webhooks.done")}</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <Form form={form} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>{t("web.webhooks.createButton")}</DialogTitle>
              </DialogHeader>

              <form.AppField
                name="name"
                children={(field) => (
                  <field.FormField label={t("web.webhooks.nameLabel")}>
                    <field.TextInput
                      placeholder={t("web.webhooks.namePlaceholder")}
                      maxLength={100}
                    />
                  </field.FormField>
                )}
              />

              <form.AppField
                name="url"
                children={(field) => (
                  <field.FormField label={t("web.webhooks.urlLabel")}>
                    <field.TextInput
                      placeholder="https://example.com/webhook"
                      type="url"
                    />
                  </field.FormField>
                )}
              />

              <form.AppField
                name="events"
                children={(field) => {
                  const events = field.state.value;
                  const allSelected = events.length === WEBHOOK_EVENTS.length;

                  const toggleEvent = (
                    event: (typeof WEBHOOK_EVENTS)[number]
                  ) => {
                    field.handleChange(
                      events.includes(event)
                        ? events.filter((e) => e !== event)
                        : [...events, event]
                    );
                  };

                  const toggleAll = () => {
                    field.handleChange(allSelected ? [] : [...WEBHOOK_EVENTS]);
                  };

                  return (
                    <Section>
                      <SectionHeader>
                        {t("web.webhooks.eventsLabel")}
                      </SectionHeader>
                      <SectionItems>
                        <SectionItem icon={null} asChild className="py-2">
                          <label>
                            <Checkbox
                              checked={
                                allSelected
                                  ? true
                                  : events.length > 0
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={toggleAll}
                            />
                            <SectionItemTitle className="text-muted-foreground">
                              {t("web.webhooks.selectAll")}
                            </SectionItemTitle>
                          </label>
                        </SectionItem>
                        {WEBHOOK_EVENTS.map((event) => (
                          <SectionItem
                            key={event}
                            icon={null}
                            asChild
                            className="py-2"
                          >
                            <label>
                              <Checkbox
                                checked={events.includes(event)}
                                onCheckedChange={() => toggleEvent(event)}
                              />
                              <SectionItemTitle>{event}</SectionItemTitle>
                            </label>
                          </SectionItem>
                        ))}
                      </SectionItems>
                    </Section>
                  );
                }}
              />

              <form.AppField
                name="workspaceIds"
                children={(field) => {
                  const selected = field.state.value;
                  const allSelected = selected.length === allWorkspaces.length;

                  const toggleWorkspace = (wsId: string) => {
                    field.handleChange(
                      selected.includes(wsId)
                        ? selected.filter((id) => id !== wsId)
                        : [...selected, wsId]
                    );
                  };

                  const toggleAll = () => {
                    field.handleChange(
                      allSelected ? [] : allWorkspaces.map((ws) => ws.id)
                    );
                  };

                  return (
                    <Section>
                      <SectionHeader>
                        {t("web.webhooks.workspacesLabel")}
                      </SectionHeader>
                      <SectionItems>
                        <SectionItem icon={null} asChild className="py-2">
                          <label>
                            <Checkbox
                              checked={
                                allSelected
                                  ? true
                                  : selected.length > 0
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={toggleAll}
                            />
                            <SectionItemTitle className="text-muted-foreground">
                              {t("web.webhooks.selectAll")}
                            </SectionItemTitle>
                          </label>
                        </SectionItem>
                        {allWorkspaces.map((ws) => (
                          <SectionItem
                            key={ws.id}
                            icon={null}
                            asChild
                            className="py-2"
                          >
                            <label>
                              <Checkbox
                                checked={selected.includes(ws.id)}
                                onCheckedChange={() => toggleWorkspace(ws.id)}
                              />
                              <SectionItemTitle>{ws.name}</SectionItemTitle>
                            </label>
                          </SectionItem>
                        ))}
                      </SectionItems>
                    </Section>
                  );
                }}
              />

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="card">{t("web.webhooks.cancel")}</Button>
                </DialogClose>
                <form.Subscribe
                  selector={(state) => [state.canSubmit, state.isSubmitting]}
                  children={([canSubmit, isSubmitting]) => (
                    <Button type="submit" disabled={!canSubmit || isSubmitting}>
                      {t("web.webhooks.createAction")}
                    </Button>
                  )}
                />
              </DialogFooter>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

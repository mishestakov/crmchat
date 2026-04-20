import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import {
  Loader2Icon,
  PowerIcon,
  PowerOffIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { LoadingScreen } from "@/components/LoadingScreen";
import { MiniAppPage } from "@/components/mini-app-page";
import { SimpleForm } from "@/components/simple-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableInput } from "@/components/ui/copiable-input";
import { DestructiveButton } from "@/components/ui/destructive-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useNavigateBack } from "@/hooks/useNavigateBack";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/api-keys/webhooks/$webhookId"
)({
  component: WebhookDetail,
});

function WebhookDetail() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { workspaceId, webhookId } = Route.useParams();
  const { data: webhooks, isPending } = useQuery(
    trpc.webhook.list.queryOptions()
  );
  const webhook = webhooks?.find((w) => w.id === webhookId);

  if (isPending) {
    return <LoadingScreen />;
  }

  if (!webhook) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/api-keys/webhooks"
        params={{ workspaceId }}
      />
    );
  }

  return (
    <MiniAppPage className="space-y-6">
      <WebhookNameForm webhookId={webhook.id} name={webhook.name} />

      <Section>
        <SectionItems>
          <SectionItem icon={null} asChild>
            <div>
              <SectionItemTitle>
                {t("web.webhooks.statusLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                <Badge
                  variant={webhook.status === "active" ? "green" : "gray"}
                  shape="squareSmall"
                >
                  {t(`web.webhooks.status.${webhook.status}`)}
                </Badge>
              </SectionItemValue>
            </div>
          </SectionItem>
          <SectionItem icon={null} asChild>
            <div>
              <div className="flex flex-col items-start gap-2 overflow-hidden">
                <SectionItemTitle>
                  {t("web.webhooks.urlLabel")}
                </SectionItemTitle>
                <div className="text-muted-foreground w-full truncate font-mono text-xs">
                  {webhook.url}
                </div>
              </div>
            </div>
          </SectionItem>
          <SectionItem icon={null} asChild>
            <div>
              <div className="flex flex-col items-start gap-2 overflow-hidden">
                <SectionItemTitle>
                  {t("web.webhooks.eventsLabel")}
                </SectionItemTitle>
                <div className="flex flex-wrap gap-1">
                  {webhook.events.map((event) => (
                    <Badge key={event} variant="secondary" shape="squareSmall">
                      {event}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </SectionItem>
        </SectionItems>
      </Section>

      {webhook.status === "disabled" && webhook.lastFailureReason && (
        <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
          {webhook.lastFailureReason}
        </div>
      )}

      <Section>
        <SectionItems>
          <RotateSecretDrawer webhookId={webhook.id}>
            <SectionItem icon={null}>
              <RefreshCwIcon className="text-muted-foreground size-4" />
              <SectionItemTitle>
                {t("web.webhooks.rotateSecretButton")}
              </SectionItemTitle>
            </SectionItem>
          </RotateSecretDrawer>
          <ToggleWebhookItem webhookId={webhook.id} status={webhook.status} />
        </SectionItems>
      </Section>

      <Section>
        <SectionItems>
          <DeleteWebhookDrawer webhookId={webhook.id} name={webhook.name}>
            <SectionItem className="text-destructive" icon={null}>
              <Trash2Icon className="size-4" />
              <SectionItemTitle>
                {t("web.webhooks.deleteButton")}
              </SectionItemTitle>
            </SectionItem>
          </DeleteWebhookDrawer>
        </SectionItems>
      </Section>
    </MiniAppPage>
  );
}

function WebhookNameForm({
  webhookId,
  name,
}: {
  webhookId: string;
  name: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { mutateAsync: updateWebhook } = useMutation(
    trpc.webhook.update.mutationOptions()
  );

  return (
    <SimpleForm
      label={t("web.webhooks.nameLabel")}
      value={name}
      valueSchema={z.string().min(1).max(100).trim()}
      onSubmit={async (newName) => {
        await updateWebhook({ webhookId, data: { name: newName } });
        queryClient.invalidateQueries(trpc.webhook.list.pathFilter());
        toast.success(t("web.webhooks.renameSuccess"));
      }}
      children={(field) => (
        <field.TextInput
          className="min-h-11 border-none font-medium"
          placeholder={t("web.webhooks.namePlaceholder")}
        />
      )}
    />
  );
}

function RotateSecretDrawer({
  webhookId,
  children,
}: {
  webhookId: string;
  children: ReactNode;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const { mutateAsync: rotateSecret, isPending } = useMutation(
    trpc.webhook.rotateSecret.mutationOptions()
  );

  const handleRotate = async () => {
    try {
      const result = await rotateSecret({ webhookId });
      setNewSecret(result.signingSecret);
      setSecretDialogOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("web.webhooks.rotateSecretError")
      );
    }
  };

  return (
    <>
      <Drawer dismissible={!isPending}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t("web.webhooks.rotateSecretButton")}</DrawerTitle>
            <DrawerDescription>
              {t("web.webhooks.rotateSecretDescription")}
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <DestructiveButton disabled={isPending} onClick={handleRotate}>
              {t("web.webhooks.rotateSecretAction")}
            </DestructiveButton>
            <DrawerClose asChild>
              <Button variant="card" disabled={isPending} className="w-full">
                {t("web.webhooks.cancel")}
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <Dialog
        open={secretDialogOpen}
        onOpenChange={(open) => {
          setSecretDialogOpen(open);
          if (!open) setNewSecret(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("web.webhooks.newSecretTitle")}</DialogTitle>
            <DialogDescription>
              {t("web.webhooks.secretWarning")} {t("web.webhooks.secretHint")}
            </DialogDescription>
          </DialogHeader>
          {newSecret && <CopyableInput value={newSecret} />}
          <DialogFooter>
            <DialogClose asChild>
              <Button className="w-full">{t("web.webhooks.done")}</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ToggleWebhookItem({
  webhookId,
  status,
}: {
  webhookId: string;
  status: "active" | "disabled";
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { mutateAsync: enableWebhook, isPending: isEnabling } = useMutation(
    trpc.webhook.enable.mutationOptions()
  );
  const { mutateAsync: disableWebhook, isPending: isDisabling } = useMutation(
    trpc.webhook.disable.mutationOptions()
  );

  const handleToggle = async () => {
    try {
      if (status === "disabled") {
        await enableWebhook({ webhookId });
        toast.success(t("web.webhooks.enableSuccess"));
      } else {
        await disableWebhook({ webhookId });
        toast.success(t("web.webhooks.disableSuccess"));
      }
      queryClient.invalidateQueries(trpc.webhook.list.pathFilter());
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : status === "disabled"
            ? t("web.webhooks.enableError")
            : t("web.webhooks.disableError")
      );
    }
  };

  return status === "disabled" ? (
    <SectionItem icon={null} onClick={handleToggle}>
      {isEnabling ? (
        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
      ) : (
        <PowerIcon className="text-muted-foreground size-4" />
      )}
      <SectionItemTitle>{t("web.webhooks.enableButton")}</SectionItemTitle>
    </SectionItem>
  ) : (
    <SectionItem icon={null} onClick={handleToggle}>
      {isDisabling ? (
        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
      ) : (
        <PowerOffIcon className="text-muted-foreground size-4" />
      )}
      <SectionItemTitle>{t("web.webhooks.disableButton")}</SectionItemTitle>
    </SectionItem>
  );
}

function DeleteWebhookDrawer({
  webhookId,
  name,
  children,
}: {
  webhookId: string;
  name: string;
  children: ReactNode;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigateBack = useNavigateBack();
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  const { mutateAsync: deleteWebhook, isPending } = useMutation(
    trpc.webhook.delete.mutationOptions()
  );

  const handleDelete = async () => {
    try {
      await deleteWebhook({ webhookId });
      queryClient.invalidateQueries(trpc.webhook.list.pathFilter());
      toast.success(t("web.webhooks.deleteSuccess"));
      navigateBack({
        fallback: {
          to: "/w/$workspaceId/settings/api-keys",
          params: { workspaceId },
        },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("web.webhooks.deleteError")
      );
    }
  };

  return (
    <Drawer dismissible={!isPending}>
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("web.webhooks.deleteTitle")}</DrawerTitle>
          <DrawerDescription>
            {t("web.webhooks.deleteDescription", { name })}
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <DestructiveButton disabled={isPending} onClick={handleDelete}>
            {t("web.webhooks.deleteAction")}
          </DestructiveButton>
          <DrawerClose asChild>
            <Button variant="card" disabled={isPending} className="w-full">
              {t("web.webhooks.cancel")}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

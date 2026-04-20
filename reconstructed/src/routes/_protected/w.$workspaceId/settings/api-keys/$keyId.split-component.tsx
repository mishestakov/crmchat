import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, createFileRoute } from "@tanstack/react-router";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { LoadingScreen } from "@/components/LoadingScreen";
import { MiniAppPage } from "@/components/mini-app-page";
import { SimpleForm } from "@/components/simple-form";
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
  "/_protected/w/$workspaceId/settings/api-keys/$keyId"
)({
  component: ApiKeyDetail,
});

function ApiKeyDetail() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { workspaceId, keyId } = Route.useParams();
  const { data: keys, isPending } = useQuery(trpc.apiKey.list.queryOptions());
  const key = keys?.find((k) => k.id === keyId);

  if (isPending) {
    return <LoadingScreen />;
  }

  if (!key) {
    return (
      <Navigate
        to="/w/$workspaceId/settings/api-keys"
        params={{ workspaceId }}
      />
    );
  }

  return (
    <MiniAppPage className="space-y-6">
      <KeyNameForm keyId={key.id} name={key.name} />
      <Section>
        <SectionItems>
          <SectionItem icon={null} asChild>
            <div>
              <SectionItemTitle>{t("web.apiKeys.keyPrefix")}</SectionItemTitle>
              <SectionItemValue className="font-mono">
                {key.keyPrefix}...
              </SectionItemValue>
            </div>
          </SectionItem>
          <SectionItem icon={null} asChild>
            <div>
              <SectionItemTitle>
                {t("web.apiKeys.createdAtLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                {format(key.createdAt, "MMM d, yyyy")}
              </SectionItemValue>
            </div>
          </SectionItem>
          <SectionItem icon={null} asChild>
            <div>
              <SectionItemTitle>
                {t("web.apiKeys.lastUsedLabel")}
              </SectionItemTitle>
              <SectionItemValue>
                {key.lastUsedAt
                  ? format(key.lastUsedAt, "MMM d, yyyy")
                  : t("web.apiKeys.neverUsed")}
              </SectionItemValue>
            </div>
          </SectionItem>
        </SectionItems>
      </Section>
      <RevokeKeySection keyId={key.id} name={key.name} />
    </MiniAppPage>
  );
}

function KeyNameForm({ keyId, name }: { keyId: string; name: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { mutateAsync: renameKey } = useMutation(
    trpc.apiKey.rename.mutationOptions()
  );

  return (
    <SimpleForm
      label={t("web.apiKeys.nameLabel")}
      value={name}
      valueSchema={z.string().min(1).max(100).trim()}
      onSubmit={async (newName) => {
        await renameKey({ keyId, name: newName });
        queryClient.invalidateQueries(trpc.apiKey.list.pathFilter());
        toast.success(t("web.apiKeys.renameSuccess"));
      }}
      children={(field) => (
        <field.TextInput
          className="min-h-11 border-none font-medium"
          placeholder={t("web.apiKeys.namePlaceholder")}
        />
      )}
    />
  );
}

function RevokeKeySection({ keyId, name }: { keyId: string; name: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigateBack = useNavigateBack();
  const { t } = useTranslation();
  const { workspaceId } = Route.useParams();

  const { mutateAsync: revokeKey, isPending } = useMutation(
    trpc.apiKey.revoke.mutationOptions()
  );

  const handleRevoke = async () => {
    await revokeKey({ keyId });
    queryClient.invalidateQueries(trpc.apiKey.list.pathFilter());
    navigateBack({
      fallback: {
        to: "/w/$workspaceId/settings/api-keys",
        params: { workspaceId },
      },
    });
  };

  return (
    <Section>
      <SectionItems>
        <Drawer dismissible={!isPending}>
          <DrawerTrigger asChild>
            <SectionItem className="text-destructive" icon={Trash2}>
              <SectionItemTitle>
                {t("web.apiKeys.revokeTitle")}
              </SectionItemTitle>
            </SectionItem>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>{t("web.apiKeys.revokeTitle")}</DrawerTitle>
              <DrawerDescription>
                {t("web.apiKeys.revokeDescription", { name })}
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              <DestructiveButton disabled={isPending} onClick={handleRevoke}>
                {t("web.apiKeys.revokeAction")}
              </DestructiveButton>
              <DrawerClose asChild>
                <Button variant="card" disabled={isPending} className="w-full">
                  {t("web.apiKeys.cancel")}
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </SectionItems>
    </Section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import Loader from "@/components/ui/loader";
import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "@/components/ui/section";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/api-keys/"
)({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((state) => state.id);

  return (
    <MiniAppPage className="flex flex-col gap-6">
      <a
        href="https://developers.crmchat.ai"
        className="block"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 py-5">
            <div className="mr-auto space-y-1">
              <CardTitle className="text-base">
                {t("web.apiKeys.docsTitle")}
              </CardTitle>
              <CardDescription>
                {t("web.apiKeys.docsDescription")}
              </CardDescription>
            </div>
            <ExternalLink className="text-muted-foreground size-4 shrink-0" />
          </CardHeader>
        </Card>
      </a>
      <ApiKeyList />
      <Section>
        <SectionItems>
          <SectionItem asChild>
            <Link
              to="/w/$workspaceId/settings/api-keys/webhooks"
              params={{ workspaceId }}
            >
              <SectionItemTitle>
                {t("web.webhooks.manageButton")}
              </SectionItemTitle>
            </Link>
          </SectionItem>
        </SectionItems>
      </Section>
    </MiniAppPage>
  );
}

function ApiKeyList() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((state) => state.id);
  const { data: keys, isPending } = useQuery(trpc.apiKey.list.queryOptions());

  return (
    <Section>
      <SectionHeader>{t("web.apiKeys.title")}</SectionHeader>
      {isPending ? (
        <div className="m-3 text-center">
          <Loader />
        </div>
      ) : (
        <SectionItems>
          {keys?.map((key) => (
            <SectionItem key={key.id} asChild>
              <Link
                to="/w/$workspaceId/settings/api-keys/$keyId"
                params={{ workspaceId, keyId: key.id }}
              >
                <SectionItemTitle>{key.name}</SectionItemTitle>
                <SectionItemValue className="font-mono">
                  {key.keyPrefix}...
                </SectionItemValue>
              </Link>
            </SectionItem>
          ))}
          <CreateKeyDialog />
        </SectionItems>
      )}
      <SectionDescription>{t("web.apiKeys.description")}</SectionDescription>
    </Section>
  );
}

function CreateKeyDialog() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("API Key");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const { mutateAsync: createKey, isPending } = useMutation(
    trpc.apiKey.create.mutationOptions()
  );

  const handleCreate = async () => {
    const result = await createKey({ name: name.trim() });
    setCreatedKey(result.plaintextKey);
    queryClient.invalidateQueries(trpc.apiKey.list.pathFilter());
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setName("API Key");
      setCreatedKey(null);
    }
  };

  return (
    <>
      <SectionItem
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="text-muted-foreground mx-0.5 size-4" />
        <SectionItemTitle className="mr-auto">
          {t("web.apiKeys.createButton")}
        </SectionItemTitle>
      </SectionItem>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("web.apiKeys.createdTitle")}</DialogTitle>
                <DialogDescription>
                  {t("web.apiKeys.createdWarning")}
                </DialogDescription>
              </DialogHeader>
              <CopyableInput value={createdKey} />
              <DialogFooter>
                <DialogClose asChild>
                  <Button className="w-full">{t("web.apiKeys.done")}</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("web.apiKeys.createButton")}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-2">
                <label htmlFor="api-key-name" className="text-sm font-medium">
                  {t("web.apiKeys.nameLabel")}
                </label>
                <Input
                  id="api-key-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("web.apiKeys.namePlaceholder")}
                  maxLength={100}
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="card">{t("web.apiKeys.cancel")}</Button>
                </DialogClose>
                <Button
                  onClick={handleCreate}
                  disabled={isPending || !name.trim()}
                >
                  {t("web.apiKeys.createAction")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

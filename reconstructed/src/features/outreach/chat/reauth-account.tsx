import { useMutation } from "@tanstack/react-query";
import { CircleXIcon, ShieldCheckIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ReauthState } from "@repo/core/types";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Loader from "@/components/ui/loader";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { subscribeToTelegramAccountReauthState } from "@/lib/db/telegram";
import { useWorkspaceStore } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";

export function ReauthWebAccountModal({
  accountId,
  onComplete,
}: {
  accountId: string;
  onComplete: () => void;
}) {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const account = useWorkspaceStore((s) => s.telegramAccountsById[accountId]);

  const [sessionId] = useState(() => nanoid());
  const [state, setState] = useState<ReauthState | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!account?.id) {
      return;
    }
    return subscribeToTelegramAccountReauthState(
      account.workspaceId,
      account.id,
      sessionId,
      (snapshot) => {
        const data = snapshot.data();
        setState(data);
        setIsLoading(false);
        if (data?.type === "success") {
          onComplete();
        }
      }
    );
  }, [account?.workspaceId, account?.id, sessionId, onComplete]);

  const reauthMutation = useMutation(
    trpc.telegram.account.reauthenticateWebClient.mutationOptions()
  );
  const submitPasswordMutation = useMutation(
    trpc.telegram.account.submitReauthPassword.mutationOptions()
  );

  const handleReauth = async () => {
    if (!account?.id || reauthMutation.isPending) {
      return;
    }
    await reauthMutation.mutateAsync({
      workspaceId: account.workspaceId,
      accountId: account.id,
      sessionId,
    });
  };

  const renderError = () => {
    if (state && "error" in state) {
      return (
        <p className="text-destructive text-sm">
          {t(`web.chat.iframe.reauth.error.${state.error ?? ""}`, {
            defaultValue: state.error,
          })}
        </p>
      );
    }
    return null;
  };

  return (
    <Dialog modal={true}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          onClick={handleReauth}
          disabled={reauthMutation.isPending}
        >
          {t("web.chat.iframe.reauth.button")}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex min-h-60 flex-col items-center justify-center gap-3"
        showCloseButton={false}
        onInteractOutside={(e) => {
          e.preventDefault();
        }}
      >
        <DialogHeader>
          <VisuallyHidden>
            <DialogTitle>Reauthentication</DialogTitle>
          </VisuallyHidden>
        </DialogHeader>
        {(!state || state.type === "idle") && (
          <>
            <Loader />
            <p className="text-center text-lg font-semibold">
              {t("web.chat.iframe.reauth.loading")}
            </p>
            <p className="text-muted-foreground text-center text-sm">
              {t("web.chat.iframe.reauth.loadingDescription")}
            </p>
            {renderError()}
          </>
        )}
        {state?.type === "passwordNeeded" && (
          <>
            <ShieldCheckIcon className="text-muted-foreground size-10" />
            <h2 className="text-center">
              {t("web.chat.iframe.reauth.enterPassword")}
            </h2>
            <div className="flex gap-2">
              <Input
                className="w-48"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("web.chat.iframe.reauth.passwordPlaceholder")}
              />
              <Button
                disabled={submitPasswordMutation.isPending || isLoading}
                onClick={() => {
                  if (!account?.id || isLoading) {
                    return;
                  }
                  setIsLoading(true);
                  submitPasswordMutation.mutate({
                    workspaceId: account.workspaceId,
                    accountId: account.id,
                    sessionId,
                    password,
                  });
                }}
              >
                {t("web.chat.iframe.reauth.submitPassword")}
              </Button>
            </div>
            {renderError()}
          </>
        )}
        {state?.type === "unknownError" && (
          <>
            <CircleXIcon className="text-destructive size-10" />
            {renderError()}
            <p className="text-muted-foreground text-xs">
              Auth Session ID: {sessionId}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { BugIcon, Frown, TriangleAlertIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { omit } from "radashi";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { ContactWithId } from "@repo/core/types";

import { DebugLogModal } from "./debug-log-modal";
import { SessionInvalidated } from "./session-invalidated";
import { useAccountAuthData } from "./use-account-auth-data";
import { useChatUnreadSync } from "./use-chat-unread-sync";
import { useClientHealthCheck } from "./use-client-health-check";
import { useProxyStatus } from "./use-proxy-health-check";
import { Button } from "@/components/ui/button";
import Loader from "@/components/ui/loader";
import { getCachedApiUrlOrFallback, getCachedDcDomain } from "@/config";
import { useTheme } from "@/hooks/useTheme";
import { useUser } from "@/hooks/useUser";
import { useWorkspaceMembers } from "@/hooks/useWorkspaceMembers";
import { useCurrentWorkspace, useWorkspaceStore } from "@/lib/store";
import { useSelectedLeadStore } from "@/lib/store/chat";
import { useDebugLogStore } from "@/lib/store/debug-log";
import { selectDisplayedPropertiesOfTelegramContacts } from "@/lib/store/selectors";
import { useWorkspacesStore } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

const EVENTS_WITH_DATA = new Set([
  "sessionRequestFailed",
  "authState",
  "authStateLegacy",
  "connectionState",
  "mtprotoSenderLogs",
]);

function useDebugMessages(accountId: string) {
  const namespace = `account:${accountId}`;
  const [add, clear] = useDebugLogStore(
    useShallow((s) => [s.addDebugMessage, s.clear])
  );
  const addDebugMessage = useCallback(
    (message: string) => add(`account:${accountId}`, message),
    [accountId, add]
  );
  const clearDebugMessages = useCallback(
    () => clear(`account:${accountId}`),
    [accountId, clear]
  );
  return { debugNamespace: namespace, addDebugMessage, clearDebugMessages };
}

function useShowProxyStatus() {
  const [showProxyStatus, setShowProxyStatus] = useState(false);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setShowProxyStatus(true);
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);
  return showProxyStatus;
}

const CURRENT_TIMESTAMP = Date.now().toString();

export function ChatIframe({
  className,
  accountId,
  contact,
}: {
  className?: string;
  accountId: string;
  contact?: ContactWithId;
}) {
  const { addDebugMessage, clearDebugMessages, debugNamespace } =
    useDebugMessages(accountId);

  const { t } = useTranslation();
  const user = useUser();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [sessionRequested, setSessionRequested] = useState(false);
  const [authState, setAuthState] = useState<string>();
  const [connectionState, setConnectionState] = useState<string>();
  const [chatLoading, setChatLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { workspaceRole } = useWorkspaceMembers();

  const isAccountActive = useWorkspaceStore((s) =>
    ["active", "offline"].includes(
      s.telegramAccountsById[accountId]?.status ?? ""
    )
  );
  const setSelectedLead = useSelectedLeadStore((s) => s.setSelectedLead);

  const { isAuthDataError, authData, refetchAuthData } = useAccountAuthData({
    workspaceId,
    accountId,
    addDebugMessage,
  });
  const { isClientError } = useClientHealthCheck({ addDebugMessage });

  const { proxyStatus } = useProxyStatus({
    workspaceId,
    accountId,
    addDebugMessage,
  });
  const showProxyStatus = useShowProxyStatus();
  const scheduleUnreadSync = useChatUnreadSync(accountId);

  useEffect(() => {
    if (isAuthDataError) {
      setError(t("web.chat.iframe.authError"));
    } else if (isClientError) {
      setError(t("web.chat.iframe.clientError"));
    }
  }, [isAuthDataError, isClientError, t]);

  const sendMessageToIframe = useCallback(
    (data: any) => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(data, "*");
        console.info(
          "[CRMchat] Message sent",
          data?.type === "sessionResponse" ? { type: data.type } : data
        );
        addDebugMessage(`-> ${data?.type ?? "unknown"}`);
      } else {
        console.error("[CRMchat] Failed to send message", data);
        addDebugMessage(
          `Failed to send a message of type "${data?.type ?? "unknown"}". Content window is not available.`
        );
      }
    },
    [addDebugMessage]
  );

  useEffect(() => {
    clearDebugMessages();
    addDebugMessage(`User ID:      ${user?.id ?? ""}`);
    addDebugMessage(`Workspace ID: ${workspaceId}`);
    addDebugMessage(`Account ID:   ${accountId}`);
    addDebugMessage(`API URL:      ${getCachedApiUrlOrFallback()}`);
    addDebugMessage(`DC Domain:    ${getCachedDcDomain()}`);
  }, [clearDebugMessages, addDebugMessage, workspaceId, accountId, user?.id]);

  useEffect(() => {
    if (!iframeRef.current) {
      return;
    }

    const listener = (event: MessageEvent) => {
      if (event.origin !== import.meta.env.VITE_TELEGRAM_CLIENT_URL) {
        return;
      }
      console.info("[CRMchat] Message received", event.data);
      if (event.data.type === "mtprotoSenderLogs") {
        for (const log of event.data.logs) {
          addDebugMessage(
            `(mtprotoSender)[${log.level.slice(0, 1).toUpperCase()}] ${log.prefix} ${log.args.map(String).join(" ")}`
          );
        }
      } else {
        addDebugMessage(
          `<- ${event.data?.type ?? "unknown"}${
            EVENTS_WITH_DATA.has(event.data?.type ?? "")
              ? ` ${JSON.stringify(omit(event.data, ["type"]))}`
              : ""
          }`
        );
      }
      if (event.data.type === "sessionRequest") {
        setSessionRequested(true);
      }
      if (event.data.type === "chatOpened") {
        setChatLoading(false);
        setSelectedLead(event.data.info);
      }
      if (event.data.type === "sessionRequestFailed") {
        setError(t("web.chat.iframe.authError"));
      }
      if (event.data.type === "authStateLegacy") {
        setAuthState(event.data.state);
      }
      if (event.data.type === "connectionState") {
        setConnectionState(event.data.state);
      }
      if (event.data.type === "chatUnreadState" && event.data.synced === true) {
        scheduleUnreadSync(
          event.data.peerId,
          event.data.username,
          event.data.unreadCount
        );
      }
    };

    window.addEventListener("message", listener);
    return () => {
      window.removeEventListener("message", listener);
    };
  }, [addDebugMessage, iframeRef, scheduleUnreadSync, setSelectedLead, t]);

  useEffect(() => {
    if (authState === "authorizationStateReady") {
      if (contact?.id) {
        sendMessageToIframe({
          type: "openChat",
          id: contact?.telegram?.id,
          username: contact?.telegram?.username,
        });
      } else {
        setChatLoading(false);
      }
    }
  }, [
    sendMessageToIframe,
    authState,
    contact?.id,
    contact?.telegram?.id,
    contact?.telegram?.username,
  ]);

  useEffect(() => {
    if (!sessionRequested || !authData) return;

    if (authData.session) {
      sendMessageToIframe({ type: "sessionResponse", ...authData });
    } else {
      addDebugMessage("No session found, breaking connection");
      setConnectionState("connectionStateBroken");
    }
    setSessionRequested(false);
  }, [sendMessageToIframe, sessionRequested, authData, addDebugMessage]);

  const { resolvedTheme: theme } = useTheme();

  const displayedProperties = useWorkspacesStore((state) =>
    selectDisplayedPropertiesOfTelegramContacts(state, workspaceId)
  );

  useEffect(() => {
    if (displayedProperties && authState === "authorizationStateReady") {
      sendMessageToIframe({
        type: "setDisplayedProperties",
        displayedProperties,
      });
    }
  }, [displayedProperties, sendMessageToIframe, authState]);

  const reset = async () => {
    await refetchAuthData();
    setSessionRequested(false);
    setAuthState(undefined);
    setConnectionState(undefined);
    setChatLoading(true);
    setError(null);
  };

  return (
    <div className="relative flex flex-1 grow overflow-hidden rounded-lg shadow">
      <iframe
        ref={iframeRef}
        className={cn("bg-background w-full", className)}
        src={
          connectionState === "connectionStateBroken"
            ? "about:blank"
            : `${import.meta.env.VITE_TELEGRAM_CLIENT_URL}?accountId=${accountId}&theme=${theme ?? "light"}&t=${CURRENT_TIMESTAMP}&p=${workspaceRole === "chatter" ? "0" : "1"}&dcDomain=${getCachedDcDomain()}`
        }
        allow="camera; microphone"
        onLoad={() => {
          addDebugMessage(`iframe loaded`);
        }}
      />
      <AnimatePresence initial={false}>
        {(error ||
          chatLoading ||
          connectionState === "connectionStateBroken") && (
          <m.div
            className="bg-card text-card-foreground absolute inset-0 flex items-center justify-center px-6"
            animate={{
              opacity: user?.id === "pC46bKmocHQaSyBVhcP499SCcEs2" ? 0.6 : 1,
            }}
            exit={{ opacity: 0 }}
          >
            {error ? (
              <div className="flex flex-col items-center justify-center gap-4 text-balance text-center">
                <Frown className="text-destructive size-6" />
                <span className="text-muted-foreground text-sm">{error}</span>
                <div className="flex gap-2">
                  <DebugLogModal debugNamespace={debugNamespace}>
                    <Button size="xs" variant="ghost">
                      Debug Log
                    </Button>
                  </DebugLogModal>
                </div>
              </div>
            ) : connectionState === "connectionStateBroken" ? (
              <SessionInvalidated
                accountId={accountId}
                isAccountActive={isAccountActive}
                debugNamespace={debugNamespace}
                onReauthComplete={reset}
              />
            ) : chatLoading ? (
              <div className="flex flex-col items-center justify-center gap-2">
                <Loader />
                {showProxyStatus && proxyStatus === false ? (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <TriangleAlertIcon className="size-4 text-yellow-500" />{" "}
                    {t("web.chat.iframe.proxyUnavailable")}
                  </div>
                ) : (
                  <div className="text-muted-foreground text-sm">
                    {authState === "authorizationStateReady"
                      ? t("web.chat.iframe.loadingChat")
                      : t("web.chat.iframe.authenticating")}
                  </div>
                )}
              </div>
            ) : null}
          </m.div>
        )}
      </AnimatePresence>

      <DebugLogModal debugNamespace={debugNamespace}>
        <button className="absolute bottom-0 p-1 text-xs opacity-10 transition-opacity hover:opacity-100">
          <BugIcon className="size-3" />
        </button>
      </DebugLogModal>
    </div>
  );
}

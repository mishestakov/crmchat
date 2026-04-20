import { Navigate, createFileRoute } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import { Chat } from "@/components/chat";
import { ResponsivePage } from "@/components/mini-app-page";
import { OutreachTabNavigation } from "@/components/outreach-tab-navigation";
import { useCanUseChat } from "@/hooks/subscription";
import { useWorkspaceStore } from "@/lib/store";

export const Route = createFileRoute("/_protected/w/$workspaceId/telegram")({
  component: RouteComponent,
});

function RouteComponent() {
  const canUseChat = useCanUseChat();
  const posthog = usePostHog();
  const hasAccounts = useWorkspaceStore((s) => s.telegramAccounts.length > 0);

  const hasCaptured = useRef(false);
  useEffect(() => {
    if (canUseChat && hasAccounts && !hasCaptured.current) {
      posthog.capture("chat_opened", { source: "chats_tab" });
      hasCaptured.current = true;
    }
  }, [posthog, canUseChat, hasAccounts]);

  if (!canUseChat) {
    return (
      <Navigate
        from={Route.fullPath}
        to="../settings/subscription"
        search={{ minPlan: "pro" }}
        replace
      />
    );
  }
  return (
    <ResponsivePage
      size="extra-wide"
      containerClassName="h-svh overflow-hidden"
      className="flex flex-col gap-2"
      helpButton={false}
    >
      <OutreachTabNavigation />
      <Chat className="" />
    </ResponsivePage>
  );
}

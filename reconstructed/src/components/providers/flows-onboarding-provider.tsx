import { FlowsProvider } from "@flows/react";
import * as components from "@flows/react-components";
import "@flows/react-components/index.css";
import * as tourComponents from "@flows/react-components/tour";
import { PropsWithChildren } from "react";

import "./flows-override.css";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuthContext } from "@/hooks/useUser";

export function FlowsOnboardingProvider({
  children,
  workspaceId,
}: PropsWithChildren<{ workspaceId: string }>) {
  const auth = useAuthContext();
  const isMobile = useIsMobile();

  if (auth.claims?._imp || import.meta.env.VITE_DISABLE_FLOWS === "true") {
    return children;
  }

  return (
    <FlowsProvider
      organizationId="0028c5a5-e9a4-4bdf-9f7b-95a33558569f"
      userId={auth.user?.id ?? null}
      userProperties={{
        appUserId: auth.user?.id ?? null,
        currentWorkspaceId: workspaceId,
        deviceType: isMobile ? "mobile" : "desktop",
      }}
      language={auth.user?.locale ?? "en"}
      environment={"production"}
      components={{ ...components }}
      tourComponents={{ ...tourComponents }}
    >
      {children}
    </FlowsProvider>
  );
}

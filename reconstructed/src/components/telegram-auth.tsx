import * as Sentry from "@sentry/react";
import { useMutation } from "@tanstack/react-query";
import { signInWithCustomToken } from "firebase/auth";
import { ShieldX } from "lucide-react";
import { PropsWithChildren, useEffect, useRef, useState } from "react";

import { LoadingScreen } from "./LoadingScreen";
import WebAppAuth from "@/components/web-app-auth";
import { useAuthContext } from "@/hooks/useUser";
import { auth } from "@/lib/firebase";
import { webApp, webAppRaw } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";

export function TelegramRequireAuth({ children }: PropsWithChildren) {
  const trpc = useTRPC();
  const { status, user } = useAuthContext();
  const [failedToAuth, setFailedToAuth] = useState(false);
  const { mutateAsync: authenticate } = useMutation(
    trpc.telegram.authenticateByInitData.mutationOptions()
  );

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  useEffect(() => {
    if (isLoading || isAuthenticated) {
      return;
    }

    async function authenticateWithTelegramIfPossible() {
      webApp?.ready();

      const initData = webAppRaw?.initData;
      if (!initData) {
        setFailedToAuth(true);
        return;
      }

      const authResponse = await authenticate({ initData });
      if (!authResponse) {
        setFailedToAuth(true);
        return;
      }
      await signInWithCustomToken(auth, authResponse.customToken);
    }
    authenticateWithTelegramIfPossible();
  }, [authenticate, isAuthenticated, isLoading]);

  // If the user is authenticated, but the telegram user id is different
  // from the webapp user id, sign out the user.
  // It fixes issue when user is switching between different telegram accounts
  const authorizedTelegramUserId = user?.telegram.id;
  const webAppTelegramUserId = webAppRaw?.initDataUnsafe?.user?.id;
  useEffect(() => {
    if (
      authorizedTelegramUserId &&
      webAppTelegramUserId &&
      authorizedTelegramUserId !== webAppTelegramUserId
    ) {
      console.info(
        "Authorized telegram user id is different from webapp telegram user id. Signing out."
      );
      auth.signOut();
    }
  }, [authorizedTelegramUserId, webAppTelegramUserId]);

  const authSpanRef = useRef<Sentry.Span | undefined>(undefined);
  useEffect(() => {
    if (!isAuthenticated && !failedToAuth) {
      authSpanRef.current = Sentry.startInactiveSpan({
        name: "Auth loader",
        op: "firebase.auth",
      });
    } else {
      authSpanRef.current?.end();
      authSpanRef.current = undefined;
    }
  }, [isAuthenticated, failedToAuth]);

  if (isAuthenticated) {
    return children;
  }

  if (failedToAuth) {
    if (!webApp) {
      return <WebAppAuth />;
    }
    return (
      <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-3">
        <ShieldX />
        <div className="text-muted-foreground text-center">Auth Required</div>
      </div>
    );
  }

  return <LoadingScreen />;
}

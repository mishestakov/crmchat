import * as Sentry from "@sentry/react";
import { QueryClient } from "@tanstack/react-query";
import {
  CatchNotFound,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import { SignalIcon } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useEffect, useState } from "react";

import { NotFoundComponent } from "@/components/not-found-component";
import { Toaster } from "@/components/ui/sonner";
import { useTelegramTheme } from "@/hooks/useTelegramTheme";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: Root,
  notFoundComponent: NotFoundComponent,
});

function Root() {
  useTelegramTheme();

  return (
    <>
      <Sentry.ErrorBoundary fallback={ErrorMessage}>
        <CatchNotFound fallback={NotFoundComponent}>
          <Outlet />
          <PostHogPageViewTracker />
          <Toaster richColors />
        </CatchNotFound>
      </Sentry.ErrorBoundary>
      <OfflineAlert />
      <Scripts />
    </>
  );
}

function PostHogPageViewTracker() {
  const posthog = usePostHog();
  const location = useLocation();

  useEffect(() => {
    posthog.capture("$pageview");
  }, [posthog, location]);

  return null;
}

function OfflineAlert() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const checkOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener("online", checkOnlineStatus);
    window.addEventListener("offline", checkOnlineStatus);
    return () => {
      window.removeEventListener("online", checkOnlineStatus);
      window.removeEventListener("offline", checkOnlineStatus);
    };
  }, []);

  if (isOnline) {
    return null;
  }

  return (
    <div className="bg-destructive text-destructive-foreground absolute left-0 right-0 top-0 z-50 flex items-start gap-3 p-4 text-sm">
      <SignalIcon className="mt-0.5 size-4 shrink-0" />
      It looks like you're offline. Please check your internet connection.
    </div>
  );
}

const ErrorMessage: Sentry.FallbackRender = ({ eventId }) => {
  return (
    <div className="flex h-[60vh] w-full flex-col justify-center p-4">
      <div className="flex flex-col gap-6">
        <h1 className="text-destructive text-3xl font-bold">Oops!</h1>
        <p className="text-muted-foreground">
          An error has occurred and we're looking into it.
          <br />
          Please try again later.
        </p>
        <p className="text-muted-foreground text-sm">
          <b>Error reference:</b>
          <br />
          {eventId}
        </p>
      </div>
    </div>
  );
};

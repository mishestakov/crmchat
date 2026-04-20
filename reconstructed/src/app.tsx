import * as Sentry from "@sentry/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { LazyMotion, MotionConfig, domMax } from "motion/react";
import { use, useState } from "react";

import { NotFoundComponent } from "./components/not-found-component";
import { AnalyticsProvider } from "./components/providers/analytics-provider";
import { AuthProvider } from "./components/providers/auth-provider";
import { ThemeProvider } from "./components/providers/theme-provider";
import { getApiUrl } from "./config";
import { getQueryClient } from "./lib/query-client";
import { TRPCProvider, createAppTRPCClient } from "./lib/trpc";
import { routeTree } from "./routeTree.gen";

const queryClient = getQueryClient();

const router = createRouter({
  routeTree,
  defaultPreload: "viewport",
  defaultViewTransition: true,
  scrollRestoration: true,
  context: { queryClient },
  defaultNotFoundComponent: NotFoundComponent,
});
setupRouterSsrQueryIntegration({ router, queryClient });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

Sentry.init({
  enabled: import.meta.env.PROD,
  environment: import.meta.env.MODE,
  dsn: "https://1c2c67ca98431583cf02fffddf042ec3@o4507420358541312.ingest.us.sentry.io/4507420360572928",
  integrations: [
    // Disable for now, see https://github.com/TanStack/router/issues/3277
    // Sentry.tanstackRouterBrowserTracingIntegration(router),
    Sentry.captureConsoleIntegration({ levels: ["error"] }),
  ],
  tracesSampleRate: 1,
  tracePropagationTargets: [/^https:\/\/[^.]+.crmchat.ai\//],
});

const trpcUrlPromise = getApiUrl("/trpc");

export default function App() {
  const trpcUrl = use(trpcUrlPromise);
  const [trpcClient] = useState(() => createAppTRPCClient(trpcUrl));

  return (
    <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          <AnalyticsProvider>
            <AuthProvider>
              <LazyMotion features={domMax}>
                <MotionConfig reducedMotion="user">
                  <RouterProvider router={router} />
                </MotionConfig>
              </LazyMotion>
            </AuthProvider>
          </AnalyticsProvider>
        </TRPCProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

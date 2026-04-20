import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/w/$workspaceId/onboarding/")({
  beforeLoad: () => {
    throw redirect({
      from: Route.fullPath,
      to: "./$stepId",
      params: {
        stepId: "telegramSales",
      },
      replace: true,
    });
  },
});

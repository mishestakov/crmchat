import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_protected/w/$workspaceId/")({
  beforeLoad: () => {
    throw redirect({
      from: Route.fullPath,
      to: "./contacts",
      replace: true,
      viewTransition: false,
    });
  },
});

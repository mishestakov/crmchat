import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/workspace/accept-invite/$wId/$inviteCode"
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/accept-invite/$workspaceId/$inviteCode",
      params: {
        workspaceId: params.wId,
        inviteCode: params.inviteCode,
      },
      replace: true,
    });
  },
});

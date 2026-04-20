import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * @deprecated
 */
export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/members/accept-invite/$wId/$inviteCode"
)({
  beforeLoad: async ({ params }) => {
    throw redirect({
      to: `/accept-invite/$workspaceId/$inviteCode`,
      params: {
        workspaceId: params.wId,
        inviteCode: params.inviteCode,
      },
    });
  },
});

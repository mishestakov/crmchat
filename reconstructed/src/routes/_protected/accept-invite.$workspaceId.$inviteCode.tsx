import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";

import { LoadingScreen } from "@/components/LoadingScreen";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { webApp } from "@/lib/telegram";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/accept-invite/$workspaceId/$inviteCode"
)({
  component: AcceptInvite,
});

function AcceptInvite() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { workspaceId, inviteCode } = Route.useParams();
  const { data: invite, isPending } = useQuery(
    trpc.workspace.getWorkspaceInvite.queryOptions({
      workspaceId,
      inviteCode,
    })
  );
  const { mutateAsync: acceptWorkspaceInvite } = useMutation(
    trpc.workspace.acceptWorkspaceInvite.mutationOptions()
  );

  if (isPending) {
    return <LoadingScreen />;
  }

  if (!invite || !invite.valid) {
    return (
      <div className="m-3">
        <ErrorCard />
      </div>
    );
  }

  return (
    <div className="flex justify-center p-3">
      <Card className="max-w-[380px]">
        <CardHeader>
          <CardTitle>{t("web.workspace.invite.acceptTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Trans
            i18nKey="web.workspace.invite.acceptDescription"
            values={{
              workspaceName: invite.workspaceName,
            }}
            components={[<strong className="sensitive" />]}
            parent="p"
            className="mt-2"
          />
        </CardContent>
        <CardFooter className="flex space-x-2">
          <Button
            onClick={async () => {
              await acceptWorkspaceInvite({ workspaceId, inviteCode });
              navigate({
                to: "/w/$workspaceId/contacts",
                params: { workspaceId },
              });
            }}
          >
            {t("web.workspace.invite.acceptButton")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              webApp?.close();
              navigate({ to: "/" });
            }}
          >
            {t("web.workspace.invite.discardButton")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function ErrorCard() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-[380px]">
      <CardHeader>
        <CardTitle>{t("web.workspace.invite.errorTitle")}</CardTitle>
      </CardHeader>
      <CardContent>{t("web.workspace.invite.errorDescription")}</CardContent>
    </Card>
  );
}

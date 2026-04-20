import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import googleCalendarIcon from "@/assets/google-calendar.svg";
import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTRPC } from "@/lib/trpc";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/google-calendar"
)({
  component: GoogleCalendarSettings,
});

function GoogleCalendarSettings() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const { data: account, refetch: refetchAccount } = useQuery(
    trpc.googleCalendar.getAccount.queryOptions(void {}, {
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    })
  );
  const { mutateAsync: disconnect } = useMutation(
    trpc.googleCalendar.disconnect.mutationOptions()
  );

  return (
    <MiniAppPage workspaceSelector={false}>
      <Card>
        <CardHeader className="flex items-center">
          <img
            src={googleCalendarIcon}
            alt="Google Calendar icon"
            className="mb-6 h-24 w-24"
          />
          <CardTitle>{t("web.googleCalendarIntegration.title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-8 text-center text-sm">
          {account ? (
            <>
              {t("web.googleCalendarIntegration.connectedAs")}{" "}
              <span className="sensitive text-primary">
                {account.email ?? account.name ?? ""}
              </span>
            </>
          ) : (
            t("web.googleCalendarIntegration.receiveReminders")
          )}
        </CardContent>
        <CardFooter>
          {account ? (
            <Button
              className="w-full"
              variant="secondary"
              onClick={async () => {
                await disconnect();
                await refetchAccount();
              }}
            >
              {t("web.googleCalendarIntegration.disconnectButton")}
            </Button>
          ) : (
            <ConnectButton />
          )}
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

function ConnectButton() {
  const trpc = useTRPC();
  const { t } = useTranslation();
  const {
    mutateAsync: createConnectionUrl,
    isPending,
    data: url,
  } = useMutation(trpc.googleCalendar.createConnectionUrl.mutationOptions({}));

  useEffect(() => {
    createConnectionUrl();
  }, [createConnectionUrl]);

  return (
    <Button asChild className="w-full" disabled={isPending}>
      <a href={url} target="_blank">
        {t("web.googleCalendarIntegration.connectButton")}
      </a>
    </Button>
  );
}

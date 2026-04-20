import { createFileRoute } from "@tanstack/react-router";
import { FolderUp } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/settings/export"
)({
  component: Export,
});

function Export() {
  const { t } = useTranslation();
  return (
    <MiniAppPage>
      <Card>
        <CardHeader className="flex items-center">
          <FolderUp className="size-24" />
          <CardTitle>{t("web.export.title")}</CardTitle>
        </CardHeader>
        <CardContent className="px-8 text-center text-sm">
          <Trans
            t={t}
            i18nKey="web.export.description"
            components={{
              1: (
                <a
                  href="mailto:ask@hints.so"
                  target="_blank"
                  className="text-primary"
                />
              ),
            }}
          />
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full" variant="secondary">
            <a href="mailto:ask@hints.so" target="_blank">
              {t("web.export.contactUsButton")}
            </a>
          </Button>
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

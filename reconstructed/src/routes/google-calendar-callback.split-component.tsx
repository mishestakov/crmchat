import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import googleCalendarIcon from "@/assets/google-calendar.svg";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface CallbackParams {
  error?: string;
  url?: string;
}

export const Route = createFileRoute("/google-calendar-callback")({
  validateSearch: (searchParams): CallbackParams => {
    return searchParams;
  },
  component: GoogleCalendarCallback,
});

function GoogleCalendarCallback() {
  const { url, error } = Route.useSearch();
  const { t } = useTranslation();

  function renderTitle() {
    if (error) {
      return (
        <CardTitle>
          {t("web.googleCalendarCallback.connectionFailedTitle")}
        </CardTitle>
      );
    }
    return (
      <CardTitle>
        {t("web.googleCalendarCallback.connectionSuccessTitle")}
      </CardTitle>
    );
  }

  function getText() {
    if (error === "missing-scope") {
      return t("web.googleCalendarCallback.missingScopeError");
    } else if (error) {
      return t("web.googleCalendarCallback.connectionError");
    }
    return t("web.googleCalendarCallback.successMessage");
  }

  function renderButton() {
    if (error === "missing-scope") {
      return (
        <Button
          onClick={() => (window.location.href = url!)}
          variant="destructive"
          className="w-full"
        >
          {t("web.googleCalendarCallback.tryAgainButton")}
        </Button>
      );
    }
    return (
      <Button
        onClick={() =>
          (window.location.href = `tg://resolve?domain=${import.meta.env.VITE_BOT_USERNAME}`)
        }
        className="w-full"
      >
        {t("web.googleCalendarCallback.openTelegramButton")}
      </Button>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <Card className="max-w-[380px]">
        <CardHeader className="flex items-center">
          <img
            src={googleCalendarIcon}
            alt="Google Calendar icon"
            className="mb-6 w-24"
          />
          {renderTitle()}
        </CardHeader>
        <CardContent className="px-8 text-center">{getText()}</CardContent>
        <CardFooter>{renderButton()}</CardFooter>
      </Card>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { HelpCircleIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "./ui/button";
import { useCurrentWorkspace } from "@/lib/store";

export function HelpButton({ offsetRem = 1.25 }: { offsetRem?: number }) {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  return (
    <Button
      variant="secondary"
      size="icon"
      title={t("web.help.button")}
      asChild
      className="fixed right-5 z-50 size-10 rounded-full shadow-[0_0_3px_rgb(0_0_0/0.15)] transition-transform hover:scale-105"
      style={{
        bottom: `calc(100vh - var(--tg-viewport-stable-height, 100vh) + ${offsetRem}rem)`,
      }}
    >
      <Link to="/w/$workspaceId/settings/help" params={{ workspaceId }}>
        <HelpCircleIcon className="!size-6" />
        <span className="sr-only">{t("web.help.button")}</span>
      </Link>
    </Button>
  );
}

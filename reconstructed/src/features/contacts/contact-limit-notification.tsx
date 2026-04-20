import { Link } from "@tanstack/react-router";
import { AlertTriangleIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useCanCreateContact } from "@/hooks/subscription";
import { useCurrentWorkspace } from "@/lib/store";
import { cn } from "@/lib/utils";

export function ContactLimitNotification({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const canCreateContact = useCanCreateContact();

  if (canCreateContact) {
    return null;
  }

  return (
    <Link
      to="/w/$workspaceId/settings/subscription"
      params={{ workspaceId }}
      search={{ minPlan: "pro" }}
      className={cn(
        "@desktop:mt-3 mt-1 flex items-center gap-2 rounded-lg bg-yellow-400 px-3 text-yellow-900 transition-colors hover:bg-yellow-500",
        className
      )}
    >
      <AlertTriangleIcon className="size-4" />
      <span className="py-2 text-sm font-medium">
        {t("web.contacts.limitReached")}
      </span>
      <i className="ml-auto" />
      <span className="px-2 py-1 text-sm font-medium underline">
        {t("web.contacts.upgrade")}
      </span>
    </Link>
  );
}

import { Link } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";
import { m } from "motion/react";
import { useTranslation } from "react-i18next";

import { CreateContactArrow } from "@/components/create-contact-arrow";
import { ResponsivePage } from "@/components/mini-app-page";
import { useCurrentWorkspace } from "@/lib/store";

export function EmptyView() {
  const { t } = useTranslation();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  return (
    <ResponsivePage
      className="flex h-full flex-col items-center justify-start"
      size="narrow"
      helpButton={false}
    >
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex w-full flex-col items-center gap-6 px-4 pt-12"
      >
        <h2 className="text-muted-foreground w-full text-center text-lg font-medium">
          {t("web.contacts.createFirstLead")}
        </h2>
        <Link
          to="/w/$workspaceId/settings/telegram-sync"
          params={{ workspaceId }}
          className="hover:bg-card/70 bg-card text-card-foreground flex w-full cursor-pointer gap-3 rounded-lg p-4 transition-colors"
        >
          <div className="bg-muted flex size-8 items-center justify-center rounded-full">
            <FolderIcon className="text-muted-foreground size-4" />
          </div>

          <div className="flex flex-col items-start justify-center gap-1">
            <h2 className="text-base font-medium">
              {t("web.contacts.syncTelegramFolders")}
            </h2>
            <p className="text-muted-foreground text-sm">
              {t("web.contacts.automaticallySyncLeads")}
            </p>
          </div>
        </Link>
        <p className="px-4 py-2 text-center text-lg font-medium">
          {t("web.contacts.orAddManually")}
        </p>
        <CreateContactArrow />
      </m.div>
    </ResponsivePage>
  );
}

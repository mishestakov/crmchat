import { FrownIcon, MehIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { DebugLogModal } from "./debug-log-modal";
import { ReauthWebAccountModal } from "./reauth-account";
import { Button } from "@/components/ui/button";

export function SessionInvalidated({
  accountId,
  isAccountActive,
  debugNamespace,
  onReauthComplete,
}: {
  accountId: string;
  isAccountActive: boolean;
  debugNamespace: string;
  onReauthComplete: () => void;
}) {
  const { t } = useTranslation();

  if (isAccountActive) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="pt-2">
            <MehIcon className="size-8 text-yellow-500" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-medium">
              {t("web.chat.iframe.reauthRequired.title")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("web.chat.iframe.reauthRequired.subtitle")}
            </p>
            <div className="mt-4 flex items-center gap-4">
              <ReauthWebAccountModal
                accountId={accountId}
                onComplete={onReauthComplete}
              />
              <DebugLogModal debugNamespace={debugNamespace}>
                <Button size="xs" variant="ghost">
                  Debug Log
                </Button>
              </DebugLogModal>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="pt-2">
          <FrownIcon className="text-destructive size-8" />
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="text-lg font-medium">
            {t("web.chat.iframe.sessionInvalidated.title")}
          </h3>
          <p className="text-sm">
            {t("web.chat.iframe.sessionInvalidated.subtitle")}
          </p>
        </div>
      </div>
      <h4 className="mt-4 text-sm font-medium">
        {t("web.chat.iframe.sessionInvalidated.whatToDoNext")}
      </h4>
      <ul className="text-muted-foreground list-outside list-disc space-y-4 pl-4 text-sm">
        <li className="text-foreground">
          {t("web.chat.iframe.sessionInvalidated.whatToDoNext_reauth")}
        </li>
        <li className="text-foreground">
          {t("web.chat.iframe.sessionInvalidated.whatToDoNext_noRecovery")}
        </li>
      </ul>

      <div className="m-2">
        <DebugLogModal debugNamespace={debugNamespace}>
          <Button size="xs" variant="ghost">
            Show Debug Log
          </Button>
        </DebugLogModal>
      </div>
    </div>
  );
}

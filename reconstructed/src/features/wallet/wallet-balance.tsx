import { Link, useLocation } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";

import { fromWalletUnits } from "@repo/core/utils";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { useCurrentOrganization, useCurrentWorkspace } from "@/lib/store";
import { webApp } from "@/lib/telegram";

export function WalletBalance({
  showTopUpButton = true,
}: {
  showTopUpButton?: boolean;
}) {
  const { t } = useTranslation();
  const balanceUnits = useCurrentOrganization(
    (o) => o.wallet?.balanceUnits ?? 0
  );
  const balance = fromWalletUnits(balanceUnits);

  const workspaceId = useCurrentWorkspace((s) => s.id);
  const location = useLocation();

  return (
    <Card className="grid grid-cols-[1fr_auto] items-center gap-2 px-6 py-4">
      <div>
        <CardTitle className="text-sm">
          {t("web.wallet.currentBalanceTitle")}
        </CardTitle>
        <CardDescription>
          <Trans
            t={t}
            i18nKey="web.wallet.creditsValue"
            values={{
              count: balance,
              formatParams: {
                count: { maximumFractionDigits: 0 },
              },
            }}
            components={[<span />]}
          />
        </CardDescription>
      </div>

      {showTopUpButton && (
        <Button size="sm" asChild>
          <Link
            to="/w/$workspaceId/wallet/top-up"
            params={{ workspaceId }}
            search={{ returnTo: webApp ? undefined : location.href }}
          >
            {t("web.wallet.topUpButton")}
          </Link>
        </Button>
      )}
    </Card>
  );
}

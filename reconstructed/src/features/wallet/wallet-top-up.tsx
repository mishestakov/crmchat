import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RadioButton } from "@/components/ui/radio-button";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedApiUrlOrFallback } from "@/config";
import { useIdToken } from "@/hooks/useIdToken";
import { useCurrentWorkspace } from "@/lib/store";
import { useTRPC } from "@/lib/trpc";
import { cn } from "@/lib/utils";

export function WalletTopUp({ returnTo }: { returnTo?: string }) {
  const { t } = useTranslation();
  const idToken = useIdToken();
  const workspaceId = useCurrentWorkspace((s) => s.id);
  const trpc = useTRPC();

  const { data } = useQuery(
    trpc.organization.wallet.getTopUpOptions.queryOptions()
  );
  const [selectedPrice, setSelectedPrice] = useState<string>();

  useEffect(() => {
    if (data?.options && !selectedPrice) {
      setSelectedPrice(data?.options[0]?.id);
    }
  }, [selectedPrice, data?.options]);

  if (!data?.options) {
    return (
      <div>
        <h1 className="mx-3 mb-2 text-lg font-medium">
          {t("web.wallet.topUp.title")}
        </h1>
        <div className="grid gap-2">
          <Skeleton className="h-11 w-full border border-transparent" />
          <Skeleton className="h-11 w-full border border-transparent" />
          <Skeleton className="h-11 w-full border border-transparent" />
          <Skeleton className="h-11 w-full border border-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mx-3 mb-2 text-lg font-medium">
        {t("web.wallet.topUp.title")}
      </h1>
      <div className="grid gap-3">
        <RadioGroupPrimitive.Root
          value={selectedPrice}
          onValueChange={setSelectedPrice}
          className="grid w-full max-w-md gap-2 text-sm"
        >
          {data.options.map((option) => (
            <RadioGroupPrimitive.Item
              key={option.id}
              value={option.id}
              className="bg-card ring-border data-[state=checked]:ring-ring grid h-11 grid-cols-[1.3rem_1fr_auto] items-center gap-2 rounded px-3 ring-[1px] data-[state=checked]:ring-2"
            >
              <span>
                <RadioGroupPrimitive.Indicator>
                  <RadioButton checked />
                </RadioGroupPrimitive.Indicator>
              </span>
              <div className="text-left">
                <Trans
                  t={t}
                  i18nKey="web.wallet.creditsValue"
                  values={{
                    count: option.credits,
                    formatParams: {
                      count: { maximumFractionDigits: 0 },
                    },
                  }}
                  components={[<span className="font-semibold" />]}
                />
              </div>
              <span className="flex items-center gap-1.5">
                {option.badge === "most_popular" && (
                  <Badge variant="blue" className="mr-3">
                    {t("web.wallet.topUp.mostPopularBadge")}
                  </Badge>
                )}

                {option.amount !== option.fullAmount && (
                  <span className="text-muted-foreground text-xs line-through">
                    {t("web.wallet.topUp.price", {
                      value: option.fullAmount / 100,
                      formatParams: {
                        value: { currency: "USD", maximumFractionDigits: 0 },
                      },
                    })}
                  </span>
                )}
                <span
                  className={cn(
                    option.amount !== option.fullAmount && "text-primary"
                  )}
                >
                  {t("web.wallet.topUp.price", {
                    value: option.amount / 100,
                    formatParams: {
                      value: { currency: "USD", maximumFractionDigits: 0 },
                    },
                  })}
                </span>
              </span>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
        <Button className="w-full" disabled={!selectedPrice} asChild>
          <a
            href={`${getCachedApiUrlOrFallback()}/stripe/top-up?idToken=${encodeURIComponent(idToken ?? "")}&workspaceId=${workspaceId ?? ""}&priceId=${selectedPrice ?? ""}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`}
          >
            {t("web.wallet.topUp.buyButton", {
              count:
                data.options.find((o) => o.id === selectedPrice)?.credits ?? 0,
              formatParams: {
                count: { currency: "USD", maximumFractionDigits: 0 },
              },
            })}
          </a>
        </Button>
        <div className="text-muted-foreground text-center text-xs">
          {t("web.wallet.topUp.moneybackGuaranteeDisclaimer")}
        </div>
      </div>
    </div>
  );
}

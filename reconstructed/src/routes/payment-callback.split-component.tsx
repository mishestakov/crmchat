import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/payment-callback")({
  component: PaymentSuccessPage,
  validateSearch: z.object({
    product: z.string().optional(),
    returnTo: z.string().optional(),
  }),
});

function PaymentSuccessPage() {
  const { t } = useTranslation();
  const { product, returnTo } = Route.useSearch();
  const isAccountPurchase = product === "telegram-accounts";

  return (
    <div className="flex h-screen w-full items-center justify-center p-4">
      <Card className="w-[400px]">
        <CardHeader className="flex items-center">
          <CardTitle className="text-center text-2xl font-medium">
            {product
              ? t("web.paymentCallback.thankYouPayment")
              : t("web.paymentCallback.thankYouSubscription")}
          </CardTitle>
        </CardHeader>
        {isAccountPurchase && (
          <CardContent>
            <p className="text-muted-foreground text-center text-sm">
              {t("web.paymentCallback.thankYouAccountPurchase")}
            </p>
          </CardContent>
        )}
        <CardFooter className="flex flex-col items-stretch space-y-2">
          <Button asChild>
            <a
              href={
                returnTo ??
                `tg://resolve?domain=${import.meta.env.VITE_BOT_USERNAME}`
              }
              target={returnTo ? undefined : "_blank"}
              rel="noopener noreferrer"
            >
              {t("web.paymentCallback.returnButton")}
            </a>
          </Button>
          <Button variant={"secondary"} asChild>
            <a
              href="https://t.me/HintsSupportBot"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("web.paymentCallback.needHelpButton")}
            </a>
          </Button>
          {!product && (
            <p className="text-muted-foreground pt-4 text-center text-xs">
              {t("web.paymentCallback.cancelInfo")}
            </p>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

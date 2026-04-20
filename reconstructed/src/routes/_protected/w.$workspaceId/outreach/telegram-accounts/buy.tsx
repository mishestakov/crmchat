import { useStore } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { MinusIcon, PlusIcon } from "lucide-react";
import { clamp } from "radashi";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import telegramIcon from "@/assets/telegram-logo.svg";
import { Form } from "@/components/form/form";
import { MiniAppPage } from "@/components/mini-app-page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TELEGRAM_ACCOUNT_PRICE_USD,
  getCachedApiUrlOrFallback,
} from "@/config";
import { useAppForm } from "@/hooks/app-form";
import { useIdToken } from "@/hooks/useIdToken";
import { useCurrentWorkspace } from "@/lib/store";

export const Route = createFileRoute(
  "/_protected/w/$workspaceId/outreach/telegram-accounts/buy"
)({
  component: RouteComponent,
});

const FormSchema = z.object({
  count: z.number().min(1).max(99),
  region: z.enum(["us-ca", "ru-kz"]),
});
type Region = z.infer<typeof FormSchema>["region"];

function RouteComponent() {
  const { t } = useTranslation();
  const idToken = useIdToken();
  const workspaceId = useCurrentWorkspace((state) => state.id);

  const form = useAppForm({
    defaultValues: {
      count: 1,
      region: "us-ca",
    } satisfies z.input<typeof FormSchema> as z.output<typeof FormSchema>,
    validators: {
      onChange: FormSchema,
    },
  });

  const { count, region } = useStore(form.store, (state) => state.values);

  return (
    <MiniAppPage>
      <Card>
        <CardHeader className="items-center gap-3">
          <img src={telegramIcon} className="size-16" />
          <CardTitle className="text-center text-lg">
            {t("web.outreach.telegramAccounts.buy.title")}
          </CardTitle>
          <CardDescription>
            {t("web.outreach.telegramAccounts.buy.description", {
              price: TELEGRAM_ACCOUNT_PRICE_USD,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Form form={form} className="space-y-3">
            <form.AppField
              name="region"
              children={(field) => (
                <field.FormItem className="ml-3 flex items-center justify-between gap-4">
                  <field.FormLabel variant="classic" className="mb-0">
                    {t("web.outreach.telegramAccounts.buy.regionLabel")}
                  </field.FormLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(val) => field.handleChange(val as Region)}
                  >
                    <field.FormControl>
                      <SelectTrigger className="max-w-56">
                        <SelectValue />
                      </SelectTrigger>
                    </field.FormControl>
                    <SelectContent>
                      <SelectItem value="us-ca">US / Canada</SelectItem>
                      <SelectItem value="ru-kz">RU / KZ</SelectItem>
                    </SelectContent>
                  </Select>
                </field.FormItem>
              )}
            />
            <form.AppField
              name="count"
              children={(field) => (
                <field.FormItem className="ml-3 flex items-center justify-between gap-4">
                  <field.FormLabel variant="classic" className="mb-0">
                    {t("web.outreach.telegramAccounts.buy.countLabel")}
                  </field.FormLabel>
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="secondary"
                        size="icon"
                        className="size-10"
                        onClick={() =>
                          field.handleChange(
                            clamp(field.state.value - 1, 1, 99)
                          )
                        }
                      >
                        <MinusIcon className="size-3" />
                      </Button>
                      <field.FormControl>
                        <Input
                          className="h-10 max-w-24 text-center font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          type="number"
                          value={field.state.value}
                          onChange={(e) =>
                            field.handleChange(
                              clamp(Number(e.target.value), 1, 99)
                            )
                          }
                        />
                      </field.FormControl>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="size-10"
                        onClick={() =>
                          field.handleChange(
                            clamp(field.state.value + 1, 1, 99)
                          )
                        }
                      >
                        <PlusIcon className="size-3" />
                      </Button>
                    </div>
                    <field.FormMessage />
                  </div>
                </field.FormItem>
              )}
            />
          </Form>

          <div className="bg-secondary rounded-lg p-3 text-sm">
            <p className="text-xs font-semibold opacity-95">
              {t("web.outreach.telegramAccounts.buy.whatsIncluded")}
            </p>
            <p className="mt-1">
              {t("web.outreach.telegramAccounts.buy.whatsIncludedDescription")}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button variant="telegram" className="w-full" asChild>
            <a
              href={`${getCachedApiUrlOrFallback()}/stripe/buy?idToken=${encodeURIComponent(idToken ?? "")}&workspaceId=${workspaceId ?? ""}&product=telegram-accounts&quantity=${count}&region=${region}`}
            >
              {t("web.outreach.telegramAccounts.buy.buyButton", {
                price: count * TELEGRAM_ACCOUNT_PRICE_USD,
              })}
            </a>
          </Button>
          <p className="text-muted-foreground mt-2 text-pretty px-6 text-center text-sm">
            {t("web.outreach.telegramAccounts.buy.footer")}
          </p>
        </CardFooter>
      </Card>
    </MiniAppPage>
  );
}

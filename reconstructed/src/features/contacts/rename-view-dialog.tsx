import { revalidateLogic } from "@tanstack/react-form";
import { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { View } from "@repo/core/types";

import { Form } from "@/components/form/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/app-form";
import { useViews } from "@/hooks/useViews";

export function RenameViewDialog({
  view,
  onAfterSave,
  children,
}: PropsWithChildren<{ view: View; onAfterSave?: (view: View) => void }>) {
  const { t } = useTranslation();
  const { views, updateViews } = useViews("contacts");

  const form = useAppForm({
    defaultValues: {
      name: view.name,
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().min(1, "Required").max(40, "Max 40 characters"),
      }),
    },
    onSubmit: async (data) => {
      await updateViews(
        views.map((v) =>
          v.id === view.id ? { ...v, name: data.value.name } : v
        )
      );
      onAfterSave?.({ ...view, name: data.value.name });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <Form form={form}>
          <DialogHeader>
            <DialogTitle>
              {t("web.contacts.views.renameViewDialog.title")}
            </DialogTitle>
          </DialogHeader>

          <form.AppField
            name="name"
            children={(field) => (
              <field.FormItem className="my-4">
                <field.FormControl>
                  <field.TextInput
                    placeholder={t(
                      "web.contacts.views.renameViewDialog.namePlaceholder"
                    )}
                  />
                </field.FormControl>
                <field.FormMessage />
              </field.FormItem>
            )}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t("web.cancel")}</Button>
            </DialogClose>
            <Button variant="default">
              {t("web.contacts.views.renameViewDialog.saveButton")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

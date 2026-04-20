import { revalidateLogic } from "@tanstack/react-form";
import { omit, pick } from "radashi";
import { PropsWithChildren, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { View } from "@repo/core/types";

import { ViewIcon } from "./view-icon";
import { Form } from "@/components/form/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAppForm } from "@/hooks/app-form";
import { useViews } from "@/hooks/useViews";
import { generateId } from "@/lib/utils";

export function SaveViewDialog({
  view,
  onAfterSave,
  children,
}: PropsWithChildren<{ view: View; onAfterSave?: (view: View) => void }>) {
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const { views, updateViews } = useViews("contacts");

  const handleSave = async (
    options: { overwrite: false; name: string } | { overwrite: true }
  ) => {
    // dont save search query
    const viewToSave = {
      ...omit(view, ["q"]),
      filters: pick(view.filters, (values) => values.length > 0),
    };
    await updateViews(
      options.overwrite
        ? views.map((v) => (v.id === view.id ? viewToSave : v))
        : [...views, { ...viewToSave, name: options.name, id: generateId() }]
    );
    setOpen(false);
    toast.success(t("web.contacts.views.saveViewDialog.successToast"));
    onAfterSave?.(viewToSave);
  };

  // restrict changing type of default views
  const isOverwriteDisabled =
    (view.id === "list" && view.type === "pipeline") ||
    (view.id === "pipeline" && view.type === "list");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="!max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("web.contacts.views.saveViewDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {isOverwriteDisabled
              ? t("web.contacts.views.saveViewDialog.descriptionCreate")
              : t(
                  "web.contacts.views.saveViewDialog.descriptionUpdateOrCreate"
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="!flex-col">
          {!isOverwriteDisabled && (
            <Button
              className="flex min-w-0 items-center gap-1.5"
              variant="card"
              onClick={() => handleSave({ overwrite: true })}
            >
              <Trans
                t={t}
                i18nKey="web.contacts.views.saveViewDialog.updateViewButton"
                components={[
                  <Badge
                    variant="secondary"
                    shape="square"
                    className="inline-flex items-center gap-1 truncate border text-sm"
                  >
                    <ViewIcon view={view} className="size-3" />
                    {view.name}
                  </Badge>,
                ]}
              />
            </Button>
          )}

          <SaveNewViewDialog
            onSave={(name) => handleSave({ overwrite: false, name })}
          >
            <Button variant="default">
              {t("web.contacts.views.saveViewDialog.saveAsNewViewButton")}
            </Button>
          </SaveNewViewDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SaveNewViewDialog({
  onSave,
  children,
}: PropsWithChildren<{ onSave: (name: string) => void }>) {
  const { t } = useTranslation();

  const form = useAppForm({
    defaultValues: {
      name: "",
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({
        name: z.string().min(1, "Required").max(40, "Max 40 characters"),
      }),
    },
    onSubmit: (data) => onSave(data.value.name),
  });

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <Form form={form}>
          <DialogHeader>
            <DialogTitle>
              {t("web.contacts.views.saveNewViewDialog.title")}
            </DialogTitle>
          </DialogHeader>

          <form.AppField
            name="name"
            children={(field) => (
              <field.FormItem className="my-4">
                <field.FormControl>
                  <field.TextInput
                    placeholder={t(
                      "web.contacts.views.saveNewViewDialog.namePlaceholder"
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
              {t("web.contacts.views.saveNewViewDialog.createButton")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

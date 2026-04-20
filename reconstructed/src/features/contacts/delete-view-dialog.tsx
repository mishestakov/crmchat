import { PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";

import { View } from "@repo/core/types";

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
import { useViews } from "@/hooks/useViews";

export function DeleteViewDialog({
  view,
  onAfterSave,
  children,
}: PropsWithChildren<{ view: View; onAfterSave?: (view: View) => void }>) {
  const { t } = useTranslation();
  const { views, updateViews } = useViews("contacts");

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("web.contacts.views.deleteViewDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("web.contacts.views.deleteViewDialog.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("web.cancel")}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={async () => {
              await updateViews(views.filter((v) => v.id !== view.id));
              onAfterSave?.(view);
            }}
          >
            {t("web.contacts.views.deleteViewDialog.deleteButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

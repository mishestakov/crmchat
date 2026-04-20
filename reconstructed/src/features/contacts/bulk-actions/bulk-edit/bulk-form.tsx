import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { PropertyFieldsForm } from "../../form/property-fields-form";
import { useBulkEditContext } from "./bulk-edit-context";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePropertiesWithMetadata } from "@/hooks/useProperties";

export function BulkEditForm() {
  const { t } = useTranslation();
  const [properties] = usePropertiesWithMetadata("contacts");
  const context = useBulkEditContext();

  const initialVisibleKeys = useMemo(
    () => new Set(Object.keys(context.updateData)),
    [context.updateData]
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("web.contacts.bulkEditDialog.title")}</DialogTitle>
        <DialogDescription>
          {t("web.contacts.bulkEditDialog.description")}
        </DialogDescription>
      </DialogHeader>
      <PropertyFieldsForm
        properties={properties}
        defaultValues={context.updateData}
        initialVisibleKeys={initialVisibleKeys}
        showRemovalHint
        onSubmit={(data) => {
          context.setUpdateData(data);
          context.setStep("preview");
        }}
        className="flex flex-col justify-center"
      >
        {({ SubmitButton, isEmpty }) => (
          <DialogFooter className="mt-3">
            <SubmitButton className="w-full" disabled={isEmpty}>
              {t("web.contacts.bulkEditDialog.previewButton")}
            </SubmitButton>
          </DialogFooter>
        )}
      </PropertyFieldsForm>
    </>
  );
}

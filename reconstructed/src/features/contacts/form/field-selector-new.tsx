import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Property } from "@repo/core/types";

import { NewPropertyButton } from "@/components/new-property-button";
import { PropertyForm } from "@/components/property-form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProperties } from "@/hooks/useProperties";
import { cn } from "@/lib/utils";

export function FieldSelectorNew({ showLabel }: { showLabel: boolean }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<{
    type: Property["type"];
    data: Partial<Property> | undefined;
  } | null>(null);
  return (
    <>
      <NewPropertyButton
        objectType="contacts"
        onSelect={(type, data: any) => setSelected({ type, data })}
      >
        <button
          type="button"
          className="bg-card/90 border-input hover:bg-primary hover:border-primary hover:text-primary-foreground flex shrink-0 gap-1 rounded-full border p-1 transition-colors"
        >
          <PlusIcon className="size-5 shrink-0" />
          <span className={cn("pr-1", { hidden: !showLabel })}>
            {t("web.contacts.form.newProperty")}
          </span>
        </button>
      </NewPropertyButton>
      <NewPropertyDialog
        type={selected?.type}
        data={selected?.data}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function NewPropertyDialog({
  type,
  data,
  onClose,
}: {
  type: Property["type"] | undefined;
  data: Partial<Property> | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [properties, updateProperties] = useProperties("contacts");
  return (
    <Dialog
      open={!!type}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-[90vw] rounded-lg sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="mx-3">
            {t("web.contacts.form.newProperty")}
          </DialogTitle>
        </DialogHeader>
        {type && (
          <PropertyForm
            type={type!}
            initialData={data as any}
            onSubmit={(newProperty) => {
              updateProperties([...properties, newProperty]);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

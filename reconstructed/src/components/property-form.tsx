import { revalidateLogic } from "@tanstack/react-form";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import {
  Property,
  SelectOption,
  propertySchema,
  propertySchemaMap,
} from "@repo/core/types";

import { Form } from "./form/form";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
  SectionItems,
} from "./ui/section";
import { SelectOptionsInput } from "./ui/select/options-input";
import { useAppForm } from "@/hooks/app-form";
import { useHiddenMainButton } from "@/hooks/useHiddenMainButton";
import { PROPERTY_METADATA } from "@/lib/properties";
import { generateId } from "@/lib/utils";

export function PropertyForm<
  T extends Property["type"],
  TInputProperty extends z.input<(typeof propertySchemaMap)[T]>,
  TOutputProperty extends z.output<(typeof propertySchemaMap)[T]>,
>({
  type,
  property,
  onSubmit,
  initialData,
}: {
  type: T;
  property?: TInputProperty;
  onSubmit: (property: TOutputProperty) => void;
  initialData?: Partial<TInputProperty>;
}) {
  const { t } = useTranslation();

  useHiddenMainButton();

  const schema = propertySchemaMap[type];
  const form = useAppForm({
    defaultValues: {
      ...Object.fromEntries(
        Object.entries(schema.shape).map(([key]) => [
          key,
          property?.[key as keyof Property] ?? undefined,
        ])
      ),
      ...initialData,
      type,
      key: property?.key ?? initialData?.key ?? `custom.${generateId()}`,
    } as z.input<typeof propertySchema>,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: schema,
    },
    onSubmit: (e) => {
      const data = schema.parse(e.value);
      onSubmit(data as TOutputProperty);
    },
  });

  const toggleDefaultOption = (option: SelectOption) => {
    if (type !== "single-select") return;

    const currentValue = form.getFieldValue("defaultValue");
    if (currentValue === option.value) {
      form.setFieldValue("defaultValue", undefined);
    } else {
      form.setFieldValue("defaultValue", option.value);
    }
  };

  const [isEditingOptions, setIsEditingOptions] = useState(false);

  return (
    <Form form={form} className="flex flex-col justify-center gap-4">
      <form.AppField
        name="name"
        children={(field) => (
          <field.FormField label={t("web.properties.form.name")}>
            <field.TextInput
              autoFocus
              placeholder={t("web.properties.form.name")}
              className="font-medium"
            />
          </field.FormField>
        )}
      />

      <Section>
        <SectionItems className="border-input rounded-lg border">
          <SectionItem icon={null} className="min-h-10 py-0">
            <SectionItemTitle>{t("web.properties.form.type")}</SectionItemTitle>
            <SectionItemValue>
              {t(PROPERTY_METADATA[type].name)}
            </SectionItemValue>
          </SectionItem>

          <form.AppField
            name="required"
            children={(field) => (
              <field.SectionItemSwitchField
                label={t("web.properties.form.required")}
              />
            )}
          />

          {"displayedInList" in schema.shape && (
            <form.AppField
              name="displayedInList"
              children={(field) => (
                <field.SectionItemSwitchField
                  label={t("web.properties.form.displayedInList")}
                />
              )}
            />
          )}
        </SectionItems>
      </Section>

      {"options" in schema.shape && (
        <form.Subscribe
          selector={(state) =>
            "defaultValue" in state.values
              ? state.values.defaultValue
              : undefined
          }
          children={(defaultValue) => (
            <form.AppField
              name="options"
              children={(field) => (
                <div>
                  <field.FormItem>
                    <field.FormLabel>
                      {t("web.properties.form.options")}
                    </field.FormLabel>
                    <field.FormControl>
                      <SelectOptionsInput
                        value={field.state.value}
                        onChange={(options) => field.handleChange(options)}
                        onEditStateChange={setIsEditingOptions}
                        defaultOption={defaultValue}
                        onToggleDefaultOption={
                          type === "single-select"
                            ? toggleDefaultOption
                            : undefined
                        }
                      />
                    </field.FormControl>
                    <field.FormMessage />
                  </field.FormItem>
                </div>
              )}
            />
          )}
        />
      )}

      <form.SubmitButton disabled={isEditingOptions}>
        {property
          ? t("web.properties.form.updateProperty")
          : t("web.properties.form.createProperty")}
      </form.SubmitButton>
    </Form>
  );
}

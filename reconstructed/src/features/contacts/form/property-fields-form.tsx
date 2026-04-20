import { revalidateLogic } from "@tanstack/react-form";
import { XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { mapKeys } from "radashi";
import { ReactNode, SetStateAction, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Property } from "@repo/core/types";

import { FieldSelector } from "./field-selector";
import { Form } from "@/components/form/form";
import { renderPropertyInput } from "@/components/property-input-renderer";
import { Button } from "@/components/ui/button";
import { useAppForm, useFocusFormField } from "@/hooks/app-form";
import { cn } from "@/lib/utils";
import { getPlainSchemaForProperties } from "@/lib/zod";

type PropertyFieldsFormProps = {
  properties: Property[];
  defaultValues: Record<string, unknown>;
  initialVisibleKeys: Set<string>;
  showRemovalHint?: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
  children: (ctx: {
    SubmitButton: ReturnType<typeof useAppForm>["SubmitButton"];
    isEmpty: boolean;
  }) => ReactNode;
  className?: string;
  fieldClassName?: string;
};

const SEP = "___";

function toSep(key: string) {
  return key.replaceAll(".", SEP);
}

function fromSep(key: string) {
  return key.replaceAll(SEP, ".");
}

/**
 * TanStack Form treats dots in field names as nested object paths.
 * Our property keys use dots as flat identifiers (e.g. "custom.pipeline_stage"),
 * so this wrapper replaces dots with "___" before passing to the form
 * and converts back on submit.
 */
export function PropertyFieldsForm(props: PropertyFieldsFormProps) {
  const sepDefaults = useMemo(
    () => mapKeys(props.defaultValues, (key) => toSep(key)),
    [props.defaultValues]
  );
  const sepProperties = useMemo(
    () => props.properties.map((p) => ({ ...p, key: toSep(p.key) })),
    [props.properties]
  );
  const sepInitialVisibleKeys = useMemo(
    () => new Set([...props.initialVisibleKeys].map(toSep)),
    [props.initialVisibleKeys]
  );

  return (
    <PropertyFieldsFormInner
      {...props}
      properties={sepProperties}
      defaultValues={sepDefaults}
      initialVisibleKeys={sepInitialVisibleKeys}
      onSubmit={(data) => {
        props.onSubmit(mapKeys(data, (key) => fromSep(key)));
      }}
    />
  );
}

function PropertyFieldsFormInner({
  properties,
  defaultValues,
  initialVisibleKeys,
  showRemovalHint = false,
  onSubmit,
  children,
  className,
  fieldClassName,
}: PropertyFieldsFormProps) {
  const { t } = useTranslation();

  const [visibleProperties, _setVisibleProperties] =
    useState(initialVisibleKeys);
  const visiblePropertiesRef = useRef(visibleProperties);
  const setVisibleProperties = (value: SetStateAction<Set<string>>) => {
    _setVisibleProperties((prev) => {
      const newValue = typeof value === "function" ? value(prev) : value;
      visiblePropertiesRef.current = newValue;
      return newValue;
    });
  };

  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: ({ formApi }) => {
        const schema = getPlainSchemaForProperties(
          properties.filter((p) => visiblePropertiesRef.current.has(p.key))
        );
        return formApi.parseValuesWithSchema(schema);
      },
    },
    onSubmit: async (e) => {
      const schema = getPlainSchemaForProperties(
        properties.filter((p) => visiblePropertiesRef.current.has(p.key))
      );
      const data = schema.parse(e.value);

      const result: Record<string, unknown> = {};
      for (const key of visibleProperties) {
        result[key] = data[key];
      }
      onSubmit(result);
    },
  });

  const focusFormField = useFocusFormField(form);

  return (
    <Form form={form} className={className}>
      <FieldSelector
        className="mb-3"
        visibleProperties={visibleProperties}
        onSelect={(key) => {
          setVisibleProperties((prev) => new Set(prev).add(key));
        }}
        setFocus={focusFormField}
        properties={properties}
        canCreateNew={false}
        label={""}
      />

      <AnimatePresence initial={false}>
        {[...visibleProperties].map((key) => {
          const property = properties.find((p) => p.key === key);
          if (!property || property.readonly) return null;

          return (
            <form.AppField
              key={key}
              name={key}
              children={(field) => (
                <motion.div
                  data-slot="form-item"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <div className={cn("py-2", fieldClassName)}>
                    <field.FormLabel>{property.name}</field.FormLabel>
                    <div className="flex items-center gap-2">
                      <field.FormControl>
                        {renderPropertyInput({
                          objectType: "contacts",
                          property,
                          field: field as any,
                        })}
                      </field.FormControl>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          setVisibleProperties((prev) => {
                            const newSet = new Set(prev);
                            newSet.delete(key);
                            return newSet;
                          });
                          form.reset();
                        }}
                      >
                        <XIcon className="size-4" />
                        <span className="sr-only">{t("web.delete")}</span>
                      </Button>
                    </div>
                    {showRemovalHint && (
                      <form.Subscribe selector={(state) => state.values[key]}>
                        {(value) => {
                          value =
                            typeof value === "string" ? value.trim() : value;
                          return (
                            <AnimatePresence initial={false}>
                              {!value && !property.required && (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                >
                                  <field.FormDescription className="mt-0 pt-1">
                                    {t(
                                      "web.contacts.bulkEditDialog.fieldWillBeRemoved"
                                    )}
                                  </field.FormDescription>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          );
                        }}
                      </form.Subscribe>
                    )}
                    <field.FormMessage />
                  </div>
                </motion.div>
              )}
            />
          );
        })}
      </AnimatePresence>

      {children({
        SubmitButton: form.SubmitButton,
        isEmpty: visibleProperties.size === 0,
      })}
    </Form>
  );
}

import { revalidateLogic } from "@tanstack/react-form";
import { deleteField } from "firebase/firestore";
import { CheckCircleIcon, CircleAlertIcon } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { get } from "radashi";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { Property } from "@repo/core/types";

import { Form } from "./form/form";
import { renderPropertyInput } from "./property-input-renderer";
import { Tip } from "./ui/tooltip";
import { useAppForm } from "@/hooks/app-form";
import { updateContact } from "@/lib/db/contacts";
import { PROPERTY_METADATA } from "@/lib/properties";
import { webApp } from "@/lib/telegram";
import { emptyToNull } from "@/lib/zod";

function useSavedIndicator() {
  const [savedIndicator, setSavedIndicator] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSavedIndicator = () => {
    setSavedIndicator(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setSavedIndicator(false);
      timeoutRef.current = null;
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  return { savedIndicator, showSavedIndicator };
}

export function PropertyRenderer({
  property,
  object,
}: {
  property: Property;
  object: any;
}) {
  const { t } = useTranslation();
  const currentValue = get(object, property.key);

  const metadata = PROPERTY_METADATA[property.type]!;
  const { savedIndicator, showSavedIndicator } = useSavedIndicator();
  const schema = z.object({
    value: metadata.getValueSchema(false),
  });
  const form = useAppForm({
    defaultValues: {
      value: currentValue ?? metadata.defaultValue,
    } as z.input<typeof schema>,
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: schema,
    },
    onSubmit: async (data) => {
      try {
        webApp?.HapticFeedback.impactOccurred("light");
        const currentVal = emptyToNull(currentValue);
        const valueToUpdate = emptyToNull(data.value.value);

        if (currentVal !== valueToUpdate) {
          showSavedIndicator();
          await updateContact(object.workspaceId, object.id, {
            [property.key]: valueToUpdate ?? deleteField(),
          });
        }
      } catch (error) {
        console.error("Failed to update property:", error);
      }
    },
    listeners: {
      onBlur: () => {
        form.handleSubmit();
      },
    },
  });

  useEffect(() => {
    if (!form.state.isDirty) {
      form.setFieldValue("value", currentValue ?? metadata.defaultValue, {
        dontUpdateMeta: true,
      });
    }
  }, [form, metadata.defaultValue, currentValue]);

  return (
    <Form form={form} suspense={false}>
      <form.AppField
        name="value"
        children={(field) => (
          <field.FormItem className="relative flex items-center gap-2 px-6 py-1.5 text-sm">
            <field.FormLabel
              className="text-muted-foreground flex w-1/3 shrink-0 items-center gap-1 font-normal"
              variant="classic"
            >
              {property.name}
            </field.FormLabel>
            <div className="w-2/3">
              <field.FormControl>
                {renderPropertyInput({
                  objectType: "contacts",
                  property,
                  field: field as any,
                })}
              </field.FormControl>
            </div>
            <AnimatePresence>
              {savedIndicator ? (
                <m.div
                  exit={{ opacity: 0 }}
                  className="absolute right-1 text-green-500"
                >
                  <CheckCircleIcon className="size-4" />
                </m.div>
              ) : (
                property.required &&
                emptyToNull(currentValue) === null && (
                  <div className="absolute right-1">
                    <Tip content={t("web.properties.required")}>
                      <CircleAlertIcon className="size-4 text-yellow-500" />
                    </Tip>
                  </div>
                )
              )}
            </AnimatePresence>
          </field.FormItem>
        )}
      />
    </Form>
  );
}

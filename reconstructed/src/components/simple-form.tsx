import { revalidateLogic } from "@tanstack/react-form";
import { AnimatePresence, m } from "motion/react";
import { ReactElement, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import * as z from "zod";

import { Form } from "./form/form";
import { Button } from "./ui/button";
import { AppFieldApi, useAppForm } from "@/hooks/app-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";

export function SimpleForm<Output, Input>({
  label,
  description,
  value,
  valueSchema,
  onSubmit,
  children,
}: {
  label: string;
  description?: string;
  value: Input;
  valueSchema: z.ZodType<Output, Input>;
  onSubmit: (value: Output) => void | Promise<void>;
  children: (field: AppFieldApi) => ReactElement<any>;
}) {
  useFormFeatures();
  const { t } = useTranslation();

  const schema = z.object({
    value: valueSchema,
  });

  const form = useAppForm({
    defaultValues: {
      value,
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: schema,
    },
    onSubmit: async (e) => {
      const data = schema.parse(e.value);
      try {
        await onSubmit(data.value);
        form.reset(e.value);
      } catch {
        toast.error(t("web.common.error.somethingWentWrong"));
      }
    },
  });

  useEffect(() => {
    form.reset({ value });
  }, [form, value]);

  return (
    <Form form={form}>
      <form.AppField
        name="value"
        children={(field) => (
          <field.FormItem>
            <field.FormLabel>{label}</field.FormLabel>
            <div className="flex w-full items-center">
              <div className="min-w-0 grow">
                <field.FormControl>
                  {children(field as unknown as AppFieldApi)}
                </field.FormControl>
              </div>
              <AnimatePresence>
                {field.state.meta.isDirty && (
                  <m.div
                    className="shrink-0 self-end overflow-hidden"
                    initial={{ width: 0 }}
                    animate={{ width: 64 }}
                    exit={{ width: 0 }}
                  >
                    <Button
                      className="ml-2 w-[56px]"
                      onClick={() => form.handleSubmit()}
                    >
                      Save
                    </Button>
                  </m.div>
                )}
              </AnimatePresence>
            </div>
            <field.FormMessage />
            {description && (
              <field.FormDescription>{description}</field.FormDescription>
            )}
          </field.FormItem>
        )}
      />
    </Form>
  );
}

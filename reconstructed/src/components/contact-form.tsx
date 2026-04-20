import { DeepKeys, revalidateLogic } from "@tanstack/react-form";
import { get, isFunction, set } from "radashi";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";

import { withDefaultValues } from "@repo/core/service/contacts";
import { ContactWithId, Property } from "@repo/core/types";

import { Form } from "./form/form";
import { renderPropertyInput } from "./property-input-renderer";
import { FieldSelector } from "@/features/contacts/form/field-selector";
import { useAppForm, useFocusFormField } from "@/hooks/app-form";
import { useFormFeatures } from "@/hooks/useFormFeatures";
import { usePropertiesWithMetadata } from "@/hooks/useProperties";
import { auth } from "@/lib/firebase";
import { PropertyMetadata } from "@/lib/properties";
import {
  buildZodSchemaForProperties,
  deepMergeZodObjects,
  zEmptyToNull,
} from "@/lib/zod";

const schema = z.object({
  ownerId: z.string(),
  fullName: z.string().trim().min(1, "Required"),
  description: zEmptyToNull(z.string().trim().nullish()),
  phone: zEmptyToNull(z.string().trim().nullish()),
  email: zEmptyToNull(z.email().nullish()),
  amount: zEmptyToNull(z.number().nullish()),
  telegram: z
    .object({
      username: zEmptyToNull(z.string().trim().nullish()),
    })
    .optional(),
  url: zEmptyToNull(z.url().nullish()),
});

export type ContactFormValues = z.output<typeof schema>;
type ContactFormKey = DeepKeys<ContactFormValues>;
type ContactProperty = Property & { key: ContactFormKey };

function useStandardProperties() {
  const { t } = useTranslation();

  const standardProperties: ContactProperty[] = [
    {
      key: "fullName",
      name: t("web.contacts.form.fullName"),
      placeholder: t("web.contacts.form.fullNamePlaceholder"),
      required: true,
      type: "text",
    },
    {
      key: "description",
      name: t("web.contacts.form.description"),
      placeholder: t("web.contacts.form.descriptionPlaceholder"),
      required: false,
      type: "textarea",
    },
    {
      key: "url",
      name: t("web.contacts.form.url"),
      placeholder: t("web.contacts.form.urlPlaceholder"),
      required: false,
      type: "url",
    },
    {
      key: "email",
      name: t("web.contacts.form.email"),
      placeholder: t("web.contacts.form.emailPlaceholder"),
      required: false,
      type: "email",
    },
    {
      key: "phone",
      name: t("web.contacts.form.phone"),
      placeholder: t("web.contacts.form.phonePlaceholder"),
      required: false,
      type: "tel",
    },
    {
      key: "telegram.username",
      name: t("web.contacts.form.telegram"),
      placeholder: t("web.contacts.form.telegramPlaceholder"),
      description: t("web.contacts.form.telegramDescription"),
      required: false,
      type: "text",
    },
  ];

  return standardProperties;
}

function getDefaultValues(
  contact: ContactWithId | undefined,
  customProperties: (Property & { metadata: PropertyMetadata })[]
) {
  let defaultValues = {
    ownerId: auth.currentUser?.uid ?? "",
    fullName: contact?.fullName ?? "",
    description: contact?.description ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
    amount: contact?.amount ?? 0,
    url: contact?.url ?? "",
    telegram: {
      username: contact?.telegram?.username ?? "",
    },
  };

  for (const property of customProperties) {
    if (property.readonly) {
      continue;
    }
    defaultValues = set(
      defaultValues,
      property.key,
      get(
        contact,
        property.key,
        isFunction(property.metadata.defaultValue)
          ? property.metadata.defaultValue()
          : property.metadata.defaultValue
      )
    );
  }

  if (!contact) {
    return withDefaultValues(defaultValues, customProperties);
  }

  return defaultValues;
}

export default function ContactForm({
  contact,
  onSubmit,
  focus,
}: {
  contact?: ContactWithId;
  onSubmit: (values: ContactFormValues) => void | Promise<void>;
  focus?: ContactFormKey;
}) {
  const { t } = useTranslation();
  useFormFeatures();
  const [customProperties] = usePropertiesWithMetadata("contacts");
  const standardProperties = useStandardProperties();

  const schemaWithCustomProps = deepMergeZodObjects(
    schema,
    buildZodSchemaForProperties(customProperties)
  );

  const form = useAppForm({
    defaultValues: getDefaultValues(contact, customProperties),
    validationLogic: revalidateLogic(),
    validators: {
      // @ts-expect-error dynamic form
      onDynamic: schemaWithCustomProps,
    },
    onSubmit: async (e) => {
      const data = schemaWithCustomProps.parse(e.value);
      await onSubmit(data as ContactFormValues);
    },
  });

  const properties: ContactProperty[] = [
    ...standardProperties,
    ...(customProperties as ContactProperty[]),
  ];

  const [visibleProperties, setVisibleProperties] = useState<
    Set<ContactFormKey>
  >(
    () =>
      new Set([
        "fullName",
        "description",

        // required fields
        ...customProperties
          .filter((p) => p.required && !p.readonly)
          .map((p) => p.key as ContactFormKey),

        // fields with values
        ...properties.filter((p) => !!get(contact, p.key)).map((p) => p.key),
      ])
  );

  const focusFormField = useFocusFormField(form);

  useEffect(() => {
    focusFormField(focus ?? "fullName");
  }, [focus, focusFormField]);

  return (
    <Form form={form} className="flex flex-col justify-center space-y-3">
      {[...visibleProperties]
        .map((key) => properties.find((p) => p.key === key))
        .filter((p): p is ContactProperty => !!p && !p.readonly)
        .map((property) => (
          <form.AppField
            key={property.key}
            name={property.key}
            children={(field) => (
              <field.FormItem>
                <field.FormLabel>{property.name}</field.FormLabel>
                <field.FormControl>
                  {renderPropertyInput({
                    objectType: "contacts",
                    property,
                    field: field as any,
                  })}
                </field.FormControl>
                {property.description && (
                  <field.FormDescription>
                    {property.description}
                  </field.FormDescription>
                )}
                <field.FormMessage />
              </field.FormItem>
            )}
          />
        ))}
      <FieldSelector
        className="ml-2 py-3"
        visibleProperties={visibleProperties}
        onSelect={(key) =>
          setVisibleProperties((prev) => new Set(prev).add(key))
        }
        setFocus={focusFormField}
        properties={properties}
      />
      <form.SubmitMainButton>
        {contact
          ? `${t("web.contacts.form.update")}`
          : t("web.contacts.form.createLead")}
      </form.SubmitMainButton>
    </Form>
  );
}

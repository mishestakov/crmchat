import {
  FormApi,
  createFormHook,
  createFormHookContexts,
} from "@tanstack/react-form";
import { ComponentProps, useCallback, useId } from "react";
import { lazyWithPreload } from "react-lazy-with-preload";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

const FIELD_COMPONENTS = {
  FormLabel: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormLabel,
    }))
  ),
  FormControl: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormControl,
    }))
  ),
  FormDescription: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormDescription,
    }))
  ),
  FormMessage: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormMessage,
    }))
  ),
  FormItem: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormItem,
    }))
  ),
  FormField: lazyWithPreload(() =>
    import("@/components/ui/tanstack-form").then((m) => ({
      default: m.FormField,
    }))
  ),
  TextInput: lazyWithPreload(() =>
    import("@/components/form/text-field").then((m) => ({
      default: m.TextInput,
    }))
  ),
  TextInputWithIcon: lazyWithPreload(() =>
    import("@/components/form/text-field").then((m) => ({
      default: m.TextInputWithIcon,
    }))
  ),
  SectionItemSwitchField: lazyWithPreload(() =>
    import("@/components/form/switch-field").then((m) => ({
      default: m.SectionItemSwitchField,
    }))
  ),
  TextAreaInput: lazyWithPreload(() =>
    import("@/components/form/text-field").then((m) => ({
      default: m.TextAreaInput,
    }))
  ),
  RichEditorInput: lazyWithPreload(() =>
    import("@/components/form/rich-editor-field").then((m) => ({
      default: m.RichEditorInput,
    }))
  ),
  TimestampInput: lazyWithPreload(() =>
    import("@/components/form/timestamp-field").then((m) => ({
      default: m.TimestampInput,
    }))
  ),
  ComboboxInput: lazyWithPreload(() =>
    import("@/components/form/combobox-field").then((m) => ({
      default: m.ComboboxInput,
    }))
  ),
  UserSelectInput: lazyWithPreload(() =>
    import("@/components/form/user-select").then((m) => ({
      default: m.UserSelectInput,
    }))
  ),
} as const;

const FORM_COMPONENTS = {
  SubmitButton: lazyWithPreload(() =>
    import("@/components/form/submit-button").then((m) => ({
      default: m.SubmitButton,
    }))
  ),
  SubmitMainButton: lazyWithPreload(() =>
    import("@/components/form/submit-button").then((m) => ({
      default: m.SubmitMainButton,
    }))
  ),
} as const;

function preloadFormComponents() {
  for (const component of Object.values(FIELD_COMPONENTS)) {
    component.preload();
  }
  for (const component of Object.values(FORM_COMPONENTS)) {
    component.preload();
  }
}
preloadFormComponents();

export function useFieldId() {
  const { formId } = useFormContext();
  const { name } = useFieldContext();
  return `${formId!}--${name}`;
}

const { useAppForm: useAppFormInternal, withForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: FIELD_COMPONENTS,
  formComponents: FORM_COMPONENTS,
});

type UseFormHook = typeof useAppFormInternal;

const useAppForm: UseFormHook = (options) => {
  const formId = useId();
  const form = useAppFormInternal({ formId, ...options });
  return form;
};

export type AppFieldApi = Parameters<
  ComponentProps<ReturnType<typeof useAppForm>["AppField"]>["children"]
>[0];

function useFocusFormField<TFormData>(
  form: FormApi<
    TFormData,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any
  >
) {
  return useCallback(
    (fieldName: keyof typeof form.fieldInfo) => {
      // eslint-disable-next-line unicorn/prefer-query-selector
      document.getElementById(`${form.formId!}--${fieldName}`)?.focus();
    },
    [form]
  );
}

export {
  useAppForm,
  useFieldContext,
  useFocusFormField,
  useFormContext,
  withForm,
};

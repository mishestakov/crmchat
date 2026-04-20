import { ComponentProps } from "react";

import { Button } from "../ui/button";
import { MainButton } from "../ui/main-button";
import { useFormContext } from "@/hooks/app-form";

export function SubmitButton({
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick">) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" {...props} disabled={disabled || isSubmitting} />
      )}
    </form.Subscribe>
  );
}

export function SubmitMainButton({
  disabled,
  ...props
}: Omit<ComponentProps<typeof MainButton>, "onClick">) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <MainButton
          {...props}
          type="button"
          disabled={disabled || isSubmitting}
          loading={isSubmitting}
          onClick={(e) => {
            e?.preventDefault();
            e?.stopPropagation();
            form.handleSubmit();
          }}
        />
      )}
    </form.Subscribe>
  );
}

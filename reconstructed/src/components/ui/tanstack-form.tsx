import { Slot } from "@radix-ui/react-slot";
import { useStore } from "@tanstack/react-form";
import * as React from "react";
import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import { useFieldContext, useFieldId } from "@/hooks/app-form";
import { cn } from "@/lib/utils";

export function FormItem(props: React.ComponentProps<"div">) {
  return <div data-slot="form-item" {...props} />;
}

export function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const id = useFieldId();
  const { store } = useFieldContext();
  const hasError = useStore(store, (state) => state.meta.errors.length > 0);
  return (
    <Label
      data-slot="form-label"
      data-error={hasError}
      className={cn("data-[error=true]:text-destructive mb-1", className)}
      htmlFor={id}
      {...props}
    />
  );
}

export function FormControl({ ...props }: React.ComponentProps<typeof Slot>) {
  const id = useFieldId();
  const { store } = useFieldContext();
  const hasError = useStore(store, (state) => state.meta.errors.length > 0);

  return (
    <Slot
      data-slot="form-control"
      id={id}
      aria-describedby={
        hasError ? `${id}--description ${id}--message` : `${id}--description`
      }
      aria-invalid={hasError}
      {...props}
    />
  );
}

export function FormDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const id = useFieldId();
  return (
    <p
      data-slot="form-description"
      id={`${id}--description`}
      className={cn("text-muted-foreground mx-3 mt-1 text-xs", className)}
      {...props}
    />
  );
}

export function FormMessage({
  className,
  ...props
}: React.ComponentProps<"p">) {
  const { t } = useTranslation();
  const id = useFieldId();
  const { store } = useFieldContext();
  const errors = useStore(store, (state) => state.meta.errors);

  const errorMessage = errors[0]?.message?.startsWith("t:")
    ? t(errors[0].message.slice(2))
    : errors[0]?.message;
  const body = errorMessage ?? props.children;
  if (!body) return null;

  return (
    <p
      data-slot="form-message"
      id={`${id}--message`}
      className={cn("text-destructive mx-3 text-sm", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export function FormField({
  label,
  description,
  children,
  ...props
}: React.ComponentProps<typeof FormItem> & {
  label: string;
  description?: string;
}) {
  return (
    <FormItem {...props}>
      <FormLabel>{label}</FormLabel>
      <FormControl>{children}</FormControl>
      <FormMessage />
      {description && <FormDescription>{description}</FormDescription>}
    </FormItem>
  );
}

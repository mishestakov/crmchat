import { useStore } from "@tanstack/react-form";

import { DistributiveOmit } from "@repo/core/types";

import { Combobox, ComboboxProps, Option } from "../ui/combobox";
import { useFieldContext } from "@/hooks/app-form";

export function ComboboxInput<TOption extends Option>({
  ...props
}: DistributiveOmit<ComboboxProps<TOption>, "value" | "onChange">) {
  const field = useFieldContext<unknown>();
  const value = useStore(field.store, (state) => state.value);
  return (
    <Combobox
      value={value}
      onChange={(value) => field.handleChange(value)}
      onBlur={() => field.handleBlur()}
      {...(props as any)}
    />
  );
}

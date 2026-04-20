import { ComponentProps } from "react";

import { DistributiveOmit } from "@repo/core/types";

import { UserSelect } from "../ui/select/user-select";
import { useFieldContext } from "@/hooks/app-form";

export function UserSelectInput({
  ...props
}: DistributiveOmit<ComponentProps<typeof UserSelect>, "value" | "onChange">) {
  const field = useFieldContext<string>();
  return (
    <UserSelect
      {...(props as any)}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
      onBlur={() => field.handleBlur()}
    />
  );
}

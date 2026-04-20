import {
  Input,
  InputProps,
  InputWithIcon,
  InputWithIconProps,
} from "../ui/input";
import { Textarea, TextareaProps } from "../ui/textarea";
import { useFieldContext, useFieldId } from "@/hooks/app-form";

export function TextInput({ ...props }: Omit<InputProps, "value">) {
  const id = useFieldId();
  const field = useFieldContext<string>();
  return (
    <Input
      id={id}
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={() => field.handleBlur()}
      {...props}
    />
  );
}

export function TextInputWithIcon({
  ...props
}: Omit<InputWithIconProps, "value">) {
  const id = useFieldId();
  const field = useFieldContext<string>();
  return (
    <InputWithIcon
      id={id}
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={() => field.handleBlur()}
      {...props}
    />
  );
}

export function TextAreaInput({ ...props }: Omit<TextareaProps, "value">) {
  const id = useFieldId();
  const field = useFieldContext<string>();
  return (
    <Textarea
      id={id}
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={() => field.handleBlur()}
      {...props}
    />
  );
}

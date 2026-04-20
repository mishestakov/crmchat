import { ComponentProps } from "react";

import { Editor } from "../ui/editor/editor";
import { useFieldContext } from "@/hooks/app-form";

export function RichEditorInput({ ...props }: ComponentProps<typeof Editor>) {
  const field = useFieldContext<string>();
  return (
    <Editor
      {...props}
      value={field.state.value}
      onChange={(value) => field.handleChange(value)}
    />
  );
}

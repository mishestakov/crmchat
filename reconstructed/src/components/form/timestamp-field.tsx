import { Timestamp } from "firebase/firestore";
import { ComponentProps } from "react";

import { DateTimePicker } from "../ui/datetime-picker";
import { useFieldContext } from "@/hooks/app-form";

export function TimestampInput(
  props: Omit<ComponentProps<typeof DateTimePicker>, "value" | "onChange">
) {
  const field = useFieldContext<Timestamp | undefined>();
  return (
    <DateTimePicker
      {...props}
      value={field.state.value?.toDate()}
      onChange={(date) =>
        field.handleChange(date ? Timestamp.fromDate(date) : undefined)
      }
    />
  );
}

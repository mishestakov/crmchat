import { SwitchProps } from "@radix-ui/react-switch";

import { SectionItem, SectionItemTitle, SectionItemValue } from "../ui/section";
import { Switch } from "../ui/switch";
import { useFieldContext } from "@/hooks/app-form";

export function SectionItemSwitchField({
  label,
  ...switchProps
}: {
  label: string;
} & Omit<SwitchProps, "value" | "onChange" | "onBlur">) {
  const field = useFieldContext<boolean>();
  return (
    <SectionItem asChild icon={null} className="min-h-10 py-0">
      <label>
        <SectionItemTitle>{label}</SectionItemTitle>
        <SectionItemValue>
          <Switch
            {...switchProps}
            checked={field.state.value}
            onCheckedChange={(checked) => field.handleChange(checked)}
            onBlur={() => field.handleBlur()}
          />
        </SectionItemValue>
      </label>
    </SectionItem>
  );
}

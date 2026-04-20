import { Check, Circle } from "lucide-react";

import { cn } from "@/lib/utils";

export function RadioButton({
  checked,
  className,
}: {
  checked: boolean;
  className?: string;
}) {
  if (checked) {
    return (
      <div className={cn("relative size-5 shrink-0", className)}>
        <Circle
          className={"text-primary fill-primary absolute max-h-full max-w-full"}
        />
        <Check
          className={
            "text-primary-foreground absolute max-h-full max-w-full scale-[0.7]"
          }
        />
      </div>
    );
  }

  return (
    <Circle
      className={cn("text-muted-foreground size-5 shrink-0", className)}
    />
  );
}

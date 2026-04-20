import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { Label } from "./label";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "focus-visible:ring-ring focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=unchecked]:bg-input peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "bg-background pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 data-[state=checked]:group-hover:translate-x-[1.125rem] data-[state=unchecked]:group-hover:translate-x-0.5"
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

const SwitchInput = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.PropsWithChildren<{
    value: boolean | undefined;
    onChange: (value: boolean) => void;
    className?: string;
  }>
>(({ children, value, onChange, className }, ref) => {
  const id = React.useId();
  return (
    <div className={cn("mr-2 flex items-center space-x-2", className)}>
      <Switch id={id} checked={value} onCheckedChange={onChange} ref={ref} />
      <Label htmlFor={id}>{children}</Label>
    </div>
  );
});
Switch.displayName = "SwitchInput";

export { Switch, SwitchInput };

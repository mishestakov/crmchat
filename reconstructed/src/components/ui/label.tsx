import * as LabelPrimitive from "@radix-ui/react-label";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// eslint-disable-next-line react-refresh/only-export-components
export const labelVariants = cva(
  "block peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      variant: {
        default: "text-muted-foreground mx-3 text-xs uppercase",
        classic: "text-sm font-medium",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);
function Label({
  className,
  variant,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      className={cn(labelVariants({ variant }), className)}
      {...props}
    />
  );
}
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };

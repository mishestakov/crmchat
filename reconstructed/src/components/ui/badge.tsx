import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "focus:ring-ring inline-flex items-center border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80 border-transparent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 border-transparent",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/80 border-transparent",
        outline: "text-foreground",

        gray: "bg-badge-gray text-badge-gray-foreground border-transparent",
        brown: "bg-badge-brown text-badge-brown-foreground border-transparent",
        orange:
          "bg-badge-orange text-badge-orange-foreground border-transparent",
        yellow:
          "bg-badge-yellow text-badge-yellow-foreground border-transparent",
        green: "bg-badge-green text-badge-green-foreground border-transparent",
        blue: "bg-badge-blue text-badge-blue-foreground border-transparent",
        purple:
          "bg-badge-purple text-badge-purple-foreground border-transparent",
        pink: "bg-badge-pink text-badge-pink-foreground border-transparent",
        red: "bg-badge-red text-badge-red-foreground border-transparent",
      },
      shape: {
        default: "rounded-full px-2.5 py-0.5",
        square: "rounded-md px-1.5 py-0.5",
        squareSmall: "rounded-sm px-1 py-0",
        inline: "rounded-full px-2",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, shape, ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant, shape }), className)}
      {...props}
    />
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };

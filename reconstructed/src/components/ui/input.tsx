import { VariantProps, cva } from "class-variance-authority";
import * as React from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    VariantProps<typeof inputVariants> {}

// eslint-disable-next-line react-refresh/only-export-components
export const inputVariants = cva(
  "border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex rounded-md border text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "h-10 min-h-10 w-full px-3 py-2",
        embedded: "h-10 w-full px-3",
        inline: "h-auto w-16 px-1 py-0",
        none: "",
        ghost:
          "hover:border-input hover:bg-card h-10 min-h-10 w-full border-transparent bg-transparent px-3 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputVariants({ variant, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export interface InputWithIconProps extends InputProps {
  inputClassName?: string;
  startIcon?: React.ReactNode;
  endIcon?: React.ReactNode;
}

const InputWithIcon = React.forwardRef<HTMLInputElement, InputWithIconProps>(
  ({ id, className, inputClassName, startIcon, endIcon, ...props }, ref) => {
    const generatedId = useId();
    const finalId = id ?? generatedId;
    return (
      <label
        className={inputVariants({
          variant: "embedded",
          className: cn(
            "[&:has(:focus-visible)]:ring-ring flex items-center [&:has(:focus-visible)]:outline-none [&:has(:focus-visible)]:ring-2 [&:has(:focus-visible)]:ring-offset-2",
            className
          ),
        })}
        htmlFor={finalId}
      >
        {startIcon}
        <input
          id={finalId}
          className={cn(
            "placeholder:text-muted-foreground size-full self-stretch justify-self-stretch border-none bg-transparent focus:outline-none",
            {
              "ml-2": startIcon,
              "mr-2": endIcon,
            },
            inputClassName
          )}
          ref={ref}
          {...props}
        />
        {endIcon}
      </label>
    );
  }
);
InputWithIcon.displayName = "InputWithIcon";

export { Input, InputWithIcon };

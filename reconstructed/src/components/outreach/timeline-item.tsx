import { Slot, Slottable } from "@radix-ui/react-slot";
import { ComponentProps, PropsWithChildren } from "react";

import { cn } from "@/lib/utils";

interface TimelineItemProps extends PropsWithChildren {
  icon: React.ReactNode;
  header: React.ReactNode;
  onClick?: () => void;
  asChild?: boolean;
  className?: string;
}

export const Timeline = ({
  className,
  children,
  ...props
}: ComponentProps<"div">) => {
  return (
    <div
      className={cn(
        "border-muted-foreground/40 relative ms-4 mt-2 flex flex-col gap-2 border-s",
        className
      )}
      {...props}
    >
      <div className="bg-background absolute -left-2 top-0 size-4" />
      <div className="bg-background absolute -left-2 bottom-0 size-4" />
      {children}
    </div>
  );
};

export const TimelineItem = ({
  icon,
  header,
  onClick,
  children,
  asChild,
  className,
}: TimelineItemProps) => {
  const Component = asChild ? Slot : "button";
  return (
    <div className="relative">
      {/* Fake icon to fix opacity issue when applied */}
      <span className="bg-background text-primary-foreground absolute -start-4 mt-1 flex size-8 items-center justify-center rounded-full">
        {icon}
      </span>
      <Component
        className={cn(
          "group relative ms-6 text-start",
          onClick ? "cursor-pointer" : "cursor-default",
          className
        )}
        onClick={onClick}
      >
        <span className="bg-primary text-primary-foreground absolute -start-10 mt-1 flex size-8 items-center justify-center rounded-full">
          {icon}
        </span>
        <div
          className={cn(
            "flex min-h-10 w-full items-center text-sm font-medium leading-none transition-colors",
            onClick && "group-hover:text-primary"
          )}
        >
          {header}
        </div>
        <Slottable>{children}</Slottable>
      </Component>
    </div>
  );
};

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipPortal = TooltipPrimitive.Portal;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-w-[var(--radix-popper-available-width)] overflow-hidden rounded-md border px-3 py-1.5 text-sm shadow-md",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

const Tip = ({
  content,
  children,
  side,
  className,
}: React.PropsWithChildren<{
  content: string | React.ReactNode;
  side?: TooltipPrimitive.TooltipContentProps["side"];
  className?: string;
}>) => {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={open}>
        <TooltipTrigger
          asChild
          type="button"
          className={className}
          onClick={() => setOpen(!open)}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onTouchStart={() => setOpen(open)}
          onKeyDown={(e) => {
            e.preventDefault();
            if (e.key === "Enter") {
              setOpen(!open);
            }
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent
            className={content ? "pointer-events-none" : "hidden"}
            collisionPadding={5}
            side={side}
          >
            <span className="inline-block">{content}</span>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

export {
  Tip,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
};

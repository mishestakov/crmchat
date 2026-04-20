import { Slot } from "@radix-ui/react-slot";
import { HTMLAttributes, PropsWithChildren } from "react";

import { ScrollBar } from "./scroll-area";
import { ScrollArea } from "./scroll-area";
import { cn } from "@/lib/utils";

export function TabList({
  children,
  className,
}: PropsWithChildren<{
  className?: string;
}>) {
  return (
    <ScrollArea
      className={cn(
        "overflow-auto overflow-x-hidden whitespace-nowrap",
        className
      )}
      type="scroll"
    >
      <div
        role="tablist"
        className="text-muted-foreground border-b-border relative flex border-b px-2"
      >
        {children}
      </div>
      <ScrollBar orientation="horizontal" className="-mb-2" />
    </ScrollArea>
  );
}

export function Tab({
  asChild,
  children,
  className,
  active,
  ...props
}: PropsWithChildren<
  { active?: boolean; asChild?: boolean } & HTMLAttributes<HTMLButtonElement>
>) {
  const Comp = asChild ? Slot : "button";
  return (
    <div className="relative">
      <Comp
        role="tab"
        aria-selected={active ? "true" : "false"}
        className={cn(
          "hover:text-foreground outline-ring group/tab block whitespace-nowrap px-2 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          active && "text-foreground",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
      <span
        className={cn(
          "absolute inset-x-0 -bottom-[1px] mx-2 h-[3px] rounded-t-full",
          active
            ? "bg-primary opacity-100"
            : "bg-muted-foreground group/tab-hover:opacity-100 opacity-0"
        )}
      />
    </div>
  );
}

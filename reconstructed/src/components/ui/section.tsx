import { Slot, Slottable } from "@radix-ui/react-slot";
import { ChevronRight, LucideIcon } from "lucide-react";
import {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
  ReactElement,
  ReactNode,
  Ref,
  createElement,
  isValidElement,
} from "react";

import { cn } from "@/lib/utils";

function checkSectionItemValue(child: ReactNode): boolean {
  if (Array.isArray(child)) {
    return child.some((c) => checkSectionItemValue(c));
  }

  if (isValidElement(child)) {
    if ((child.type as any)?.displayName === "SectionItemValue") {
      return true;
    }

    const props = child.props as { children?: ReactNode };
    if (props.children) {
      return checkSectionItemValue(props.children);
    }
  }

  return false;
}

export function Section({
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <div {...props}>{children}</div>;
}

export function SectionHeader({
  className,
  children,
}: PropsWithChildren<{ asChild?: boolean; className?: string }>) {
  return (
    <div
      className={cn(
        "text-muted-foreground mx-3 mb-1 text-xs uppercase",
        className
      )}
    >
      {children}
    </div>
  );
}

export function SectionDescription({
  className,
  children,
}: PropsWithChildren<{ asChild?: boolean; className?: string }>) {
  return (
    <div className={cn("text-muted-foreground mx-3 mt-1.5 text-xs", className)}>
      {children}
    </div>
  );
}

export function SectionItems({
  asChild,
  className,
  children,
}: PropsWithChildren<{ asChild?: boolean; className?: string }>) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp className={cn("divide-background flex flex-col divide-y", className)}>
      {children}
    </Comp>
  );
}

export function SectionItem({
  asChild,
  className,
  icon,
  children,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  icon?: ReactElement | LucideIcon | null;
  ref?: Ref<HTMLButtonElement>;
}) {
  const Comp = asChild ? Slot : "button";
  if (Comp === "button") props.type = "button";

  const renderIcon = () => {
    if (isValidElement(icon)) {
      return icon;
    }

    if (icon === undefined) {
      return (
        <ChevronRight className="text-muted-foreground group-hover:text-foreground -mx-1 h-5 w-5 shrink-0 translate-x-0 transition-transform group-hover:translate-x-0.5" />
      );
    }

    if (icon !== null) {
      return createElement(icon, {
        className:
          "size-4 opacity-60 group-hover:opacity-100 transition-opacity shrink-0",
      });
    }

    return null;
  };

  const hasSectionItemValue = checkSectionItemValue(children);

  return (
    <Comp
      {...props}
      ref={ref}
      className={cn(
        "bg-card hover:bg-card/70 group flex items-center gap-3 px-3 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg",
        className
      )}
    >
      <Slottable>{children}</Slottable>
      {!hasSectionItemValue && <i className="ml-auto" />}
      {renderIcon()}
    </Comp>
  );
}

export function SectionItemTitle({
  className,
  children,
}: PropsWithChildren<{ asChild?: boolean; className?: string }>) {
  return (
    <div className={cn("truncate text-sm font-medium", className)}>
      {children}
    </div>
  );
}

export function SectionItemValue({
  className,
  children,
}: PropsWithChildren<{ asChild?: boolean; className?: string }>) {
  return (
    <div
      className={cn(
        `text-muted-foreground ml-auto flex items-center gap-2 whitespace-nowrap text-sm`,
        className
      )}
    >
      {children}
    </div>
  );
}
SectionItemValue.displayName = "SectionItemValue";

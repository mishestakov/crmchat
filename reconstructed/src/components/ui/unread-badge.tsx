import { VariantProps, cva } from "class-variance-authority";

import { Badge } from "./badge";
import { cn } from "@/lib/utils";

const unreadBadgeVariants = cva("font-semibold", {
  variants: {
    size: {
      default: "px-1.5 py-0.5 text-xs",
      sm: "h-4 px-1 text-[10px]",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

export type UnreadBadgeProps = {
  count: number;
  maxCount?: number;
  className?: string;
} & VariantProps<typeof unreadBadgeVariants>;

export function UnreadBadge({
  count,
  maxCount = 99,
  className,
  size,
}: UnreadBadgeProps) {
  const displayCount = count > maxCount ? `${maxCount}+` : count.toString();

  if (count === 0) {
    return null;
  }

  return (
    <Badge
      variant="default"
      className={cn(unreadBadgeVariants({ size }), className)}
    >
      {displayCount}
    </Badge>
  );
}

export function UnreadIndicator({ className }: { className?: string }) {
  return <div className={cn("bg-primary size-2 rounded-full", className)} />;
}

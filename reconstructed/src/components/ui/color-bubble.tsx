import { Color } from "@repo/core/types";

import { cn } from "@/lib/utils";

const COLORS = {
  gray: "bg-badge-gray-foreground",
  brown: "bg-badge-brown-foreground",
  orange: "bg-badge-orange-foreground",
  yellow: "bg-badge-yellow-foreground",
  green: "bg-badge-green-foreground",
  blue: "bg-badge-blue-foreground",
  purple: "bg-badge-purple-foreground",
  pink: "bg-badge-pink-foreground",
  red: "bg-badge-red-foreground",
} satisfies Record<Color, string>;

export function ColorBubble({
  color,
  className,
}: {
  color?: Color;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-4 rounded-full border border-transparent",
        color
          ? COLORS[color]
          : "bg-muted group-hover/colorpicker:border-muted-foreground/30",
        className
      )}
    />
  );
}

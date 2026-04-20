import { Columns3Icon, ListIcon } from "lucide-react";

import { View } from "@repo/core/types";

import { cn } from "@/lib/utils";

export function ViewIcon({
  view,
  className,
}: {
  view: View;
  className?: string;
}) {
  const IconComp = view.type === "list" ? ListIcon : Columns3Icon;
  return <IconComp className={cn("shrink-0", className)} />;
}

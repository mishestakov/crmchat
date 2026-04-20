import { LoaderIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export default function Loader({ className }: { className?: string }) {
  return <LoaderIcon className={cn("animate-spin", className)} />;
}

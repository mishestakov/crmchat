import { format } from "date-fns";
import { PropsWithChildren } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useDebugLogStore } from "@/lib/store/debug-log";

export function DebugLogModal({
  debugNamespace,
  children,
}: PropsWithChildren<{ debugNamespace: string }>) {
  const debugLog = useDebugLogStore((s) => s.namespaces[debugNamespace]);
  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Debug log</DialogTitle>
        </DialogHeader>

        <Textarea
          className="font-mono text-xs"
          readOnly
          value={(debugLog ?? [])
            .map(
              (entry) =>
                `${format(entry.date, "HH:mm:ss.SSS")} ${entry.message}`
            )
            .join("\n")}
          rows={20}
          onFocus={(e) => {
            e.target.select();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

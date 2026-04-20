import { Copy } from "lucide-react";
import { Check } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useState } from "react";

import { InputWithIcon } from "./input";
import { cn } from "@/lib/utils";

export function CopyableInput({
  id,
  value,
  className,
  inputClassName,
}: {
  id?: string;
  value: string;
  className?: string;
  inputClassName?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator?.clipboard?.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <InputWithIcon
      id={id}
      readOnly
      className={cn("relative", className)}
      inputClassName={inputClassName}
      onFocus={(e) =>
        setTimeout(async () => {
          e.target.select();
          await copy();
        }, 0)
      }
      onMouseUp={(e) => e.preventDefault()}
      value={value}
      endIcon={
        <button
          className="bg-card absolute right-0 flex items-center space-x-2 px-2"
          onClick={async (e) => {
            e.preventDefault();
            await copy();
          }}
        >
          <AnimatePresence>
            {copied && (
              <m.span
                className="text-primary overflow-hidden font-sans"
                initial={{ width: 0 }}
                exit={{ width: 0 }}
                animate={{ width: "auto" }}
              >
                Copied
              </m.span>
            )}
          </AnimatePresence>
          {copied ? (
            <Check className="size-4" />
          ) : (
            <Copy className="text-muted-foreground hover:text-foreground size-4" />
          )}
        </button>
      }
    />
  );
}

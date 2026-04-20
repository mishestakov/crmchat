import { Slot } from "@radix-ui/react-slot";
import { useIsPresent } from "motion/react";
import { PropsWithChildren } from "react";
import { createPortal } from "react-dom";

export function FixedElement({ children }: PropsWithChildren) {
  const isPresent = useIsPresent();
  if (!isPresent) return null;
  return createPortal(<Slot className="fixed">{children}</Slot>, document.body);
}

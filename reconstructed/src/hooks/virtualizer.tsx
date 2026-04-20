import { useVirtualizer as useVirtualizerOriginal } from "@tanstack/react-virtual";

/*
 * This is a wrapper that prevents the virtualizer from being memoized.
 * Fixes the issue where the virtualizer would not update.
 * https://github.com/TanStack/virtual/issues/736
 */
export const useVirtualizer = (
  ...args: Parameters<typeof useVirtualizerOriginal>
) => {
  "use no memo";
  return { ...useVirtualizerOriginal(...args) };
};

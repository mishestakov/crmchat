import { useEffect } from "react";

function isInViewport(element: Element) {
  const rect = element.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
  );
}

export function useInputInViewport() {
  useEffect(() => {
    const listener = (e: FocusEvent) => {
      setTimeout(() => {
        document.body.classList.remove("no-scroll");
        const target = e.target as HTMLElement | undefined;
        const isInput =
          target &&
          (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target.isContentEditable);

        if (!isInput) {
          return;
        }

        const scrollTargetId = target?.dataset.scrollTargetId;
        const scrollTarget = scrollTargetId
          ? // eslint-disable-next-line unicorn/prefer-query-selector
            (document.getElementById(scrollTargetId) ?? target)
          : target;

        if (!isInViewport(scrollTarget)) {
          scrollTarget.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 500);
    };
    document.addEventListener("focusin", listener, true);
    return () => {
      document.removeEventListener("focusin", listener, true);
    };
  });
}

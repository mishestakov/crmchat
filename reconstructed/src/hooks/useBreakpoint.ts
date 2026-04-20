import { useEffect, useState } from "react";

const BREAKPOINTS = {
  sm: window.matchMedia("(min-width: 640px)"),
  md: window.matchMedia("(min-width: 769px)"),
};

export function useBreakpoint(breakpoint: "sm" | "md") {
  const [matches, setMatches] = useState(BREAKPOINTS[breakpoint].matches);

  useEffect(() => {
    const listener = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };
    BREAKPOINTS[breakpoint].addEventListener("change", listener);
    return () => {
      BREAKPOINTS[breakpoint].removeEventListener("change", listener);
    };
  }, [breakpoint]);

  return matches;
}

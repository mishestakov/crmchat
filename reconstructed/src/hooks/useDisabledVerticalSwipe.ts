import { useEffect } from "react";

import { webApp } from "@/lib/telegram";

export function useDisabledVerticalSwipe() {
  useEffect(() => {
    webApp?.disableVerticalSwipes();
    return () => {
      webApp?.enableVerticalSwipes();
    };
  }, []);
}

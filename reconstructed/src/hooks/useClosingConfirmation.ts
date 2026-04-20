import { useEffect } from "react";

import { webApp } from "@/lib/telegram";

export function useClosingConfirmation() {
  useEffect(() => {
    webApp?.enableClosingConfirmation();
    return () => {
      webApp?.disableClosingConfirmation();
    };
  }, []);
}

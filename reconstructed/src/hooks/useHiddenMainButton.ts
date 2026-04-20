import { useEffect } from "react";

import { webApp } from "@/lib/telegram";

export function useHiddenMainButton() {
  useEffect(() => {
    if (!webApp?.MainButton.isVisible) {
      return;
    }
    webApp?.MainButton.hide();
    return () => {
      webApp?.MainButton.show();
    };
  }, []);
}

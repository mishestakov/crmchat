import { useEffect } from "react";

import { webApp } from "@/lib/telegram";

export function useExpandedView() {
  useEffect(() => {
    webApp?.expand();
  }, []);
}

import { useEffect, useState } from "react";

import { webApp } from "@/lib/telegram";

export function useSafeArea() {
  const [safeArea, setSafeArea] = useState(
    webApp?.contentSafeAreaInset ?? {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }
  );

  useEffect(() => {
    const listener = () => {
      setSafeArea({ ...webApp!.contentSafeAreaInset });
    };
    webApp?.onEvent("contentSafeAreaChanged", listener);
    return () => {
      webApp?.offEvent("contentSafeAreaChanged", listener);
    };
  }, []);

  return safeArea;
}

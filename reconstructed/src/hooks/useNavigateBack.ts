import {
  NavigateOptions,
  useCanGoBack,
  useRouter,
} from "@tanstack/react-router";
import { useCallback } from "react";

export function useNavigateBack() {
  const canGoBack = useCanGoBack();
  const router = useRouter();

  const navigateBack = useCallback(
    (options: { fallback: NavigateOptions }) => {
      if (canGoBack) {
        router.history.back();
      } else {
        router.navigate(options.fallback);
      }
    },
    [canGoBack, router]
  );

  return navigateBack;
}

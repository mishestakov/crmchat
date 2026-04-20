import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "@/lib/trpc";

export function useAccountAuthData({
  workspaceId,
  accountId,
  addDebugMessage,
}: {
  workspaceId: string;
  accountId: string;
  addDebugMessage?: (message: string) => void;
}) {
  const trpc = useTRPC();
  const { data, refetch, isLoading, error } = useQuery(
    trpc.telegram.account.getAccountConnectionData.queryOptions(
      { workspaceId, accountId },
      {
        refetchInterval: false,
        refetchOnWindowFocus: false,
      }
    )
  );

  useEffect(() => {
    if (isLoading) {
      return;
    }

    if (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      addDebugMessage?.(
        `Failed to fetch account auth data, error=${errorMessage}`
      );
    } else {
      addDebugMessage?.(`Auth data loaded`);
    }
  }, [isLoading, error, addDebugMessage]);

  return { authData: data, refetchAuthData: refetch, isAuthDataError: !!error };
}

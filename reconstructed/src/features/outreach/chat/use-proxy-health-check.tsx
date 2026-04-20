import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useTRPC } from "@/lib/trpc";

export function useProxyStatus({
  workspaceId,
  accountId,
  addDebugMessage,
}: {
  workspaceId: string;
  accountId: string;
  addDebugMessage?: (message: string) => void;
}) {
  const trpc = useTRPC();
  const { data, isFetching, error } = useQuery(
    trpc.proxy.getProxyStatus.queryOptions(
      { workspaceId, accountId },
      {
        refetchInterval: false,
        refetchOnWindowFocus: false,
        trpc: {
          context: {
            skipBatch: true,
          },
        },
      }
    )
  );

  useEffect(() => {
    if (isFetching) {
      return;
    }

    if (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      addDebugMessage?.(`Failed to fetch proxy status, error=${errorMessage}`);
      return;
    }

    if (!data) {
      addDebugMessage?.(`Proxy status is unknown`);
      return;
    }

    addDebugMessage?.(
      `Proxy status: ${data.active ? "available" : "unavailable"}. Country Code: ${data.countryCode}`
    );
  }, [isFetching, error, data, addDebugMessage]);

  return { proxyStatus: data ? data.active : null };
}

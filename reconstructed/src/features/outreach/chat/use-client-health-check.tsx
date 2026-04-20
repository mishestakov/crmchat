import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

const HEALTH_CHECK_URL = `${import.meta.env.VITE_TELEGRAM_CLIENT_URL}/health.json`;

export function useClientHealthCheck({
  addDebugMessage,
}: {
  addDebugMessage: (message: string) => void;
}) {
  const { isFetching, error } = useQuery({
    queryKey: ["tg-client.health"],
    queryFn: async () => {
      const response = await fetch(HEALTH_CHECK_URL);
      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }
      const text = await response.text();

      try {
        return JSON.parse(text);
      } catch (err) {
        throw new Error(`Invalid JSON: ${text}`, { cause: err });
      }
    },
  });

  useEffect(() => {
    if (isFetching) {
      return;
    }

    if (error) {
      const errorMessage =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Health check failed", error);
      addDebugMessage(`Client health error: ${errorMessage}`);
    } else {
      addDebugMessage(`Client is healthy`);
    }
  }, [isFetching, error, addDebugMessage]);

  return { isClientError: !!error };
}

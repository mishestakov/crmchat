import { queryOptions, useQuery } from "@tanstack/react-query";

const opts = queryOptions({
  queryKey: ["user-country"],
  queryFn: async () => {
    const response = await fetch("https://api.country.is/");
    const data = await response.json();
    return data?.country ?? undefined;
  },
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

export function useUserCountryCode(): string | undefined {
  const { data } = useQuery(opts);
  return data;
}

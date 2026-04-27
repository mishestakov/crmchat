import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { OUTREACH_QK } from "./query-keys";

export function useOutreachAccounts(wsId: string) {
  return useQuery({
    queryKey: OUTREACH_QK.accounts(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

// Sequence detail — переиспользуется на index/accounts/leads/contact-settings.
export function useSequence(wsId: string, seqId: string) {
  return useQuery({
    queryKey: OUTREACH_QK.sequence(wsId, seqId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

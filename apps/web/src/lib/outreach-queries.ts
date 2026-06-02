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
export function useProject(wsId: string, projectId: string) {
  return useQuery({
    queryKey: OUTREACH_QK.project(wsId, projectId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

// Шаринговые ссылки проекта — нужны в трёх фазах кабинета (Согласование/Запуск/
// Отчёт), каждая копирует ссылку клиенту. Один хук вместо трёх копий queryFn.
export function useProjectShares(wsId: string, projectId: string) {
  return useQuery({
    queryKey: OUTREACH_QK.shares(wsId, projectId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/shares",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

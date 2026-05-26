import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { BackButton } from "../../../../../components/back-button";

export const Route = createFileRoute("/_authenticated/w/$wsId/campaigns/new")({
  // ?clientId=X из tree-кнопки «+ кампания» под клиентом — предзаполняем селект.
  validateSearch: (s: Record<string, unknown>) => ({
    clientId: typeof s.clientId === "string" ? s.clientId : undefined,
  }),
  component: NewCampaignPage,
});

function NewCampaignPage() {
  const { wsId } = Route.useParams();
  const { clientId: preset } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Клиенты = tracks (в agency-ws все kind='client').
  const tracksQ = useQuery({
    queryKey: ["tracks", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const [trackId, setTrackId] = useState(preset ?? "");
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/v1/workspaces/{wsId}/projects", {
        params: { path: { wsId } },
        body: { trackId, name: name.trim() },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["campaigns", wsId] });
      navigate({
        to: "/w/$wsId/campaigns/$campaignId",
        params: { wsId, campaignId: project.id },
      });
    },
  });

  const canSubmit = trackId.length > 0 && name.trim().length > 0 && !create.isPending;
  const noClients = tracksQ.data && tracksQ.data.length === 0;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Новая кампания</h1>
        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          {noClients ? (
            <p className="text-sm text-zinc-500">
              Сначала создайте клиента — кампания заводится под клиента.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-sm text-zinc-600">Клиент</span>
                <select
                  value={trackId}
                  onChange={(e) => setTrackId(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">— выбрать —</option>
                  {tracksQ.data?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-zinc-600">
                  Название кампании
                </span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Q4 Holiday B2B"
                  className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </label>
              {create.error && (
                <p className="text-sm text-red-600">
                  {errorMessage(create.error)}
                </p>
              )}
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => create.mutate()}
                className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {create.isPending ? "Создаём…" : "Создать"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

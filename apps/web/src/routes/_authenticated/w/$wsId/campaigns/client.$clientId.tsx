import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { phaseLabel, formatRub } from "./-shared";
import { Chip } from "./-ui";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/campaigns/client/$clientId",
)({
  component: ClientPage,
});

// Реквизиты клиента живут в tracks.properties (jsonb) — без отдельных колонок
// (спека §3.1). Поля-строки, рендерятся как форма.
const FIELDS = [
  { key: "legal_entity", label: "Юр. лицо" },
  { key: "inn", label: "ИНН" },
  { key: "accountant_contact", label: "Контакт бухгалтерии" },
  { key: "notes", label: "Заметки" },
] as const;

function ClientPage() {
  const { wsId, clientId } = Route.useParams();
  const qc = useQueryClient();

  const clientsQ = useQuery({
    queryKey: ["tracks", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/projects", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const client = clientsQ.data?.find((t) => t.id === clientId);
  const campaigns = (campaignsQ.data ?? []).filter((p) => p.trackId === clientId);

  if (clientsQ.isLoading) {
    return <div className="p-6 text-sm text-zinc-500">Загрузка…</div>;
  }
  if (!client) {
    return <div className="p-6 text-sm text-zinc-500">Клиент не найден.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
          Клиент
        </div>
        <h1 className="text-xl font-semibold">{client.name}</h1>
      </div>

      <RequisitesCard
        wsId={wsId}
        clientId={clientId}
        properties={client.properties as Record<string, unknown>}
      />

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Кампании</h2>
          <Link
            to="/w/$wsId/campaigns/new"
            params={{ wsId }}
            search={{ clientId }}
            className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            <Plus size={15} /> Новая кампания
          </Link>
        </div>
        {campaigns.length === 0 ? (
          <p className="text-sm text-zinc-500">У клиента пока нет кампаний.</p>
        ) : (
          <div className="space-y-1.5">
            {campaigns.map((p) => (
              <Link
                key={p.id}
                to="/w/$wsId/campaigns/$campaignId"
                params={{ wsId, campaignId: p.id }}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 hover:border-emerald-200"
              >
                <span className="truncate text-sm font-medium text-zinc-900">
                  {p.name}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm text-zinc-500">
                    {formatRub(p.budgetAmount)}
                  </span>
                  <Chip tone="violet">{phaseLabel(p.phase)}</Chip>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RequisitesCard({
  wsId,
  clientId,
  properties,
}: {
  wsId: string;
  clientId: string;
  properties: Record<string, unknown>;
}) {
  const qc = useQueryClient();
  const server = Object.fromEntries(
    FIELDS.map((f) => [f.key, (properties[f.key] as string | undefined) ?? ""]),
  );
  const [draft, setDraft] = useState<Record<string, string>>(server);
  const dirty = JSON.stringify(draft) !== JSON.stringify(server);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/tracks/{trackId}",
        {
          params: { path: { wsId, trackId: clientId } },
          // Мержим в существующие properties, чтобы не затереть прочие ключи.
          body: { properties: { ...properties, ...draft } },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tracks", wsId] }),
  });

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold text-zinc-900">Реквизиты</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-zinc-500">{f.label}</span>
            <input
              value={draft[f.key] ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [f.key]: e.target.value }))
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
        ))}
      </div>
      {dirty && (
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      )}
      {save.error && (
        <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
      )}
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/new",
)({
  component: NewSequencePage,
});

function NewSequencePage() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [listId, setListId] = useState<string>("");

  const lists = useQuery({
    queryKey: OUTREACH_QK.lists(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/lists",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/sequences",
        {
          params: { path: { wsId } },
          body: { listId, name: name.trim() },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (seq) => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
      navigate({
        to: "/w/$wsId/outreach/sequences/$seqId",
        params: { wsId, seqId: seq.id },
      });
    },
  });

  const canSubmit =
    !!listId && name.trim().length > 0 && !create.isPending;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Новая рассылка</h1>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">Название</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Конференция Q2"
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">
              Список лидов
            </span>
            {lists.isLoading ? (
              <p className="text-xs text-zinc-500">Загрузка списков…</p>
            ) : !lists.data || lists.data.length === 0 ? (
              <p className="text-xs text-amber-700">
                Нет загруженных списков. Сначала загрузите CSV.
              </p>
            ) : (
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">— выберите список —</option>
                {lists.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.importStats?.imported ?? 0} лидов)
                  </option>
                ))}
              </select>
            )}
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
        </div>
      </div>
    </div>
  );
}

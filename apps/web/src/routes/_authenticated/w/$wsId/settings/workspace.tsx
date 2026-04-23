import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

export const Route = createFileRoute("/_authenticated/w/$wsId/settings/workspace")({
  component: WorkspaceSettings,
});

function WorkspaceSettings() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();

  const ws = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
    select: (rows) => rows.find((w) => w.id === wsId),
  });

  const [name, setName] = useState("");
  // Заливаем форму один раз по id (см. контактную карточку — та же логика).
  useEffect(() => {
    if (ws.data) setName(ws.data.name);
  }, [ws.data?.id]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH("/v1/workspaces/{id}", {
        params: { path: { id: wsId } },
        body: { name },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  return (
    <div className="mx-auto max-w-xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Настройки</h1>

      {ws.isLoading && <p>Загрузка…</p>}
      {ws.error && <p className="text-red-600">{errorMessage(ws.error)}</p>}

      {ws.data && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name !== ws.data?.name) save.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">Название</span>
            <input
              className="w-full rounded border border-zinc-300 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={
                save.isPending || !name.trim() || name === ws.data.name
              }
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Сохранить
            </button>
            {save.isSuccess && !save.isPending && (
              <span className="text-sm text-green-700">Сохранено</span>
            )}
            {save.error && (
              <span className="text-sm text-red-600">
                {errorMessage(save.error)}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-500">
            ID: <code>{ws.data.id}</code>
          </p>
        </form>
      )}
    </div>
  );
}

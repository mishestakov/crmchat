import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/lists/$listId",
)({
  component: ListDetailPage,
});

function ListDetailPage() {
  const { wsId, listId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: OUTREACH_QK.list(wsId, listId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/lists/{listId}",
        { params: { path: { wsId, listId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const leads = useQuery({
    queryKey: OUTREACH_QK.leads(wsId, listId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/lists/{listId}/leads",
        {
          params: {
            path: { wsId, listId },
            query: { limit: 100, offset: 0 },
          },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/lists/{listId}",
        { params: { path: { wsId, listId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.lists(wsId) });
      navigate({ to: "/w/$wsId/outreach/lists", params: { wsId } });
    },
  });

  if (list.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-3xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (list.error || !list.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-3xl text-red-600">
          {list.error ? errorMessage(list.error) : "Список не найден"}
        </p>
      </div>
    );
  }

  const stats = list.data.importStats;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{list.data.name}</h1>
            <p className="mt-1 text-xs text-zinc-500">
              CSV{list.data.sourceMeta.fileName ? ` · ${list.data.sourceMeta.fileName}` : ""}
              {" · "}
              {leads.data?.total ?? "…"} лидов
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Удалить список «${list.data!.name}»? Лиды тоже будут удалены.`)) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Удалить список
          </button>
        </div>

        {stats && (stats.skippedDuplicate > 0 || stats.skippedMissingIdentifier > 0 || stats.skippedInvalidPhone > 0) && (
          <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
            <div className="font-medium">Пропущено при импорте</div>
            <ul className="mt-1 ml-5 list-disc text-xs space-y-0.5">
              {stats.skippedMissingIdentifier > 0 && (
                <li>{stats.skippedMissingIdentifier} без username и телефона</li>
              )}
              {stats.skippedInvalidPhone > 0 && (
                <li>{stats.skippedInvalidPhone} с некорректным номером</li>
              )}
              {stats.skippedDuplicate > 0 && (
                <li>{stats.skippedDuplicate} дубликатов внутри файла</li>
              )}
            </ul>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          {leads.isLoading && (
            <p className="px-5 py-4 text-sm text-zinc-500">Загрузка лидов…</p>
          )}
          {leads.error && (
            <p className="px-5 py-4 text-sm text-red-600">
              {errorMessage(leads.error)}
            </p>
          )}
          {leads.data && leads.data.leads.length === 0 && (
            <p className="px-5 py-4 text-sm text-zinc-500">
              В списке нет лидов
            </p>
          )}
          {leads.data && leads.data.leads.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-3 text-left font-normal">Username</th>
                  <th className="px-5 py-3 text-left font-normal">Телефон</th>
                  <th className="px-5 py-3 text-left font-normal">
                    Доп. поля
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.data.leads.map((l) => (
                  <tr key={l.id} className="border-t border-zinc-100">
                    <td className="px-5 py-2.5">
                      {l.username ? (
                        <span className="text-zinc-700">@{l.username}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      {l.phone ?? <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-xs text-zinc-500">
                      {Object.entries(l.properties)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {leads.data && leads.data.total > leads.data.leads.length && (
            <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
              Показано {leads.data.leads.length} из {leads.data.total}.
              Пагинация — отдельным шагом.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

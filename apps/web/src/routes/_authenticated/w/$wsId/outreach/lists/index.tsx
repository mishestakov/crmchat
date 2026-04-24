import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/lists/",
)({
  component: OutreachListsPage,
});

function OutreachListsPage() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
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

  const remove = useMutation({
    mutationFn: async (listId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/lists/{listId}",
        { params: { path: { wsId, listId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.lists(wsId) }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Списки лидов</h1>
        <Link
          to="/w/$wsId/outreach/lists/new"
          params={{ wsId }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus size={14} /> Новый список
        </Link>
      </div>

      {lists.isLoading && <p className="text-sm text-zinc-500">Загрузка…</p>}
      {lists.error && (
        <p className="text-sm text-red-600">{errorMessage(lists.error)}</p>
      )}

      {lists.data && lists.data.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center text-sm shadow-sm">
          <FileText size={28} className="mx-auto mb-3 text-zinc-400" />
          <p className="mb-2 font-medium">Нет списков</p>
          <p className="mb-4 text-zinc-500">
            Загрузите CSV с лидами, чтобы запускать рассылки.
          </p>
          <Link
            to="/w/$wsId/outreach/lists/new"
            params={{ wsId }}
            className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Загрузить CSV
          </Link>
        </div>
      )}

      {lists.data && lists.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <ul className="divide-y divide-zinc-100">
            {lists.data.map((list) => {
              const stats = list.importStats;
              return (
                <li
                  key={list.id}
                  className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-zinc-50"
                  onClick={() =>
                    navigate({
                      to: "/w/$wsId/outreach/lists/$listId",
                      params: { wsId, listId: list.id },
                    })
                  }
                >
                  <FileText size={18} className="shrink-0 text-zinc-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{list.name}</div>
                    <div className="text-xs text-zinc-500">
                      {stats?.imported ?? 0} лидов
                      {stats && stats.skippedDuplicate > 0 && (
                        <> · {stats.skippedDuplicate} дублей</>
                      )}
                      {stats &&
                        stats.skippedMissingIdentifier +
                          stats.skippedInvalidPhone >
                          0 && (
                          <>
                            {" "}
                            ·{" "}
                            {stats.skippedMissingIdentifier +
                              stats.skippedInvalidPhone}{" "}
                            пропущено
                          </>
                        )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Удалить список «${list.name}»?`)) {
                        remove.mutate(list.id);
                      }
                    }}
                    disabled={remove.isPending}
                    className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

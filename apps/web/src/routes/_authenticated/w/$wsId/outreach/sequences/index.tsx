import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/",
)({
  component: SequencesPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  active: "Идёт",
  paused: "Пауза",
  completed: "Завершена",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-800",
  completed: "bg-zinc-100 text-zinc-500",
};

function SequencesPage() {
  const { wsId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const sequences = useQuery({
    queryKey: OUTREACH_QK.sequences(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const remove = useMutation({
    mutationFn: async (seqId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) }),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Рассылки</h1>
        <Link
          to="/w/$wsId/outreach/sequences/new"
          params={{ wsId }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus size={14} /> Новая рассылка
        </Link>
      </div>

      {sequences.isLoading && (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      )}
      {sequences.error && (
        <p className="text-sm text-red-600">{errorMessage(sequences.error)}</p>
      )}

      {sequences.data && sequences.data.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center text-sm shadow-sm">
          <Send size={28} className="mx-auto mb-3 text-zinc-400" />
          <p className="mb-2 font-medium">Пока нет рассылок</p>
          <p className="mb-4 text-zinc-500">
            Создайте рассылку из списка лидов.
          </p>
          <Link
            to="/w/$wsId/outreach/sequences/new"
            params={{ wsId }}
            className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Новая рассылка
          </Link>
        </div>
      )}

      {sequences.data && sequences.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <ul className="divide-y divide-zinc-100">
            {sequences.data.map((seq) => (
              <li
                key={seq.id}
                className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-zinc-50"
                onClick={() =>
                  navigate({
                    to: "/w/$wsId/outreach/sequences/$seqId",
                    params: { wsId, seqId: seq.id },
                  })
                }
              >
                <Send size={18} className="shrink-0 text-zinc-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{seq.name}</div>
                  <div className="text-xs text-zinc-500">
                    {seq.messages.length} сообщений
                  </div>
                </div>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-xs " +
                    (STATUS_COLORS[seq.status] ?? "bg-zinc-100")
                  }
                >
                  {STATUS_LABELS[seq.status] ?? seq.status}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Удалить рассылку «${seq.name}»?`)) {
                      remove.mutate(seq.id);
                    }
                  }}
                  disabled={remove.isPending}
                  className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

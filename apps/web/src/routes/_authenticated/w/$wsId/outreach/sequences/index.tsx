import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/",
)({
  component: CampaignsPage,
});

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  active: "Идёт",
  paused: "На паузе",
  completed: "Завершена",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-amber-100 text-amber-800",
  completed: "bg-zinc-100 text-zinc-500",
};

function CampaignsPage() {
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

  const accounts = useOutreachAccounts(wsId);

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
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <ul className="divide-y divide-zinc-100">
          <li>
            <Link
              to="/w/$wsId/outreach/accounts"
              params={{ wsId }}
              className="flex items-center px-5 py-3 text-sm hover:bg-zinc-50"
            >
              <span className="flex-1">Аккаунты для рассылок</span>
              <span className="mr-2 text-xs text-zinc-500">
                {accounts.data?.length ?? "—"}
              </span>
              <ChevronRight size={16} className="text-zinc-400" />
            </Link>
          </li>
          <li>
            <Link
              to="/w/$wsId/outreach/schedule"
              params={{ wsId }}
              className="flex items-center px-5 py-3 text-sm hover:bg-zinc-50"
            >
              <span className="flex-1">Расписание отправки</span>
              <ChevronRight size={16} className="text-zinc-400" />
            </Link>
          </li>
        </ul>
      </div>

      <div>
        <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Кампании
        </div>
        {sequences.isLoading && (
          <p className="text-sm text-zinc-500">Загрузка…</p>
        )}
        {sequences.error && (
          <p className="text-sm text-red-600">
            {errorMessage(sequences.error)}
          </p>
        )}
        {sequences.data && (
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
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {seq.name}
                    </div>
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
                      if (confirm(`Удалить кампанию «${seq.name}»?`)) {
                        remove.mutate(seq.id);
                      }
                    }}
                    disabled={remove.isPending}
                    className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50"
                  >
                    Удалить
                  </button>
                  <ChevronRight size={16} className="text-zinc-400" />
                </li>
              ))}
              <li>
                <Link
                  to="/w/$wsId/outreach/sequences/new"
                  params={{ wsId }}
                  className="flex items-center px-5 py-3 text-sm text-zinc-600 hover:bg-zinc-50"
                >
                  <Plus size={16} className="mr-3 text-zinc-400" />
                  <span className="flex-1">Новая кампания</span>
                  <ChevronRight size={16} className="text-zinc-400" />
                </Link>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

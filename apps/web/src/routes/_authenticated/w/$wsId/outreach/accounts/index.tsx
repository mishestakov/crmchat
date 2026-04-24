import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send } from "lucide-react";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/accounts/",
)({
  component: OutreachAccountsList,
});

const STATUS_LABEL: Record<string, string> = {
  active: "активен",
  banned: "забанен",
  frozen: "заморожен",
  unauthorized: "разлогинен",
  offline: "не на связи",
};

const STATUS_COLOR: Record<string, string> = {
  active: "bg-emerald-500",
  banned: "bg-red-500",
  frozen: "bg-amber-500",
  unauthorized: "bg-zinc-400",
  offline: "bg-zinc-300",
};

function OutreachAccountsList() {
  const { wsId } = Route.useParams();
  const qc = useQueryClient();
  const accounts = useQuery({
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

  const remove = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/accounts/{accountId}",
        { params: { path: { wsId, accountId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.accounts(wsId) }),
  });

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Аккаунты-отправители</h1>
        <Link
          to="/w/$wsId/outreach/accounts/new"
          params={{ wsId }}
          className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus size={14} /> Добавить
        </Link>
      </div>

      <p className="text-sm text-zinc-500">
        Отдельные TG-аккаунты для холодных рассылок. Личные не используем —
        Telegram банит за массовую отправку с обычных аккаунтов (≈5/день
        без Premium).
      </p>

      {accounts.isLoading && (
        <p className="text-sm text-zinc-500">Загрузка…</p>
      )}
      {accounts.error && (
        <p className="text-sm text-red-600">
          {errorMessage(accounts.error)}
        </p>
      )}

      {accounts.data && accounts.data.length === 0 && (
        <div className="rounded-2xl bg-white p-8 text-center text-sm shadow-sm">
          <Send size={28} className="mx-auto mb-3 text-sky-500" />
          <p className="mb-2 font-medium">Нет аккаунтов</p>
          <p className="mb-4 text-zinc-500">
            Подключите хотя бы один TG-аккаунт, чтобы запускать рассылки.
          </p>
          <Link
            to="/w/$wsId/outreach/accounts/new"
            params={{ wsId }}
            className="inline-block rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Подключить аккаунт
          </Link>
        </div>
      )}

      {accounts.data && accounts.data.length > 0 && (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <ul className="divide-y divide-zinc-100">
            {accounts.data.map((acc) => (
              <li key={acc.id} className="flex items-center gap-3 px-5 py-3">
                <span
                  className={
                    "h-2.5 w-2.5 shrink-0 rounded-full " +
                    (STATUS_COLOR[acc.status] ?? "bg-zinc-300")
                  }
                  title={STATUS_LABEL[acc.status] ?? acc.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">
                      {acc.firstName || acc.tgUsername || "Без имени"}
                    </span>
                    {acc.hasPremium && (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                        premium
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {acc.tgUsername ? `@${acc.tgUsername}` : null}
                    {acc.tgUsername && acc.phoneNumber ? " · " : null}
                    {acc.phoneNumber ?? null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        `Отключить аккаунт ${
                          acc.firstName || acc.tgUsername || acc.phoneNumber || ""
                        }? Сессия будет удалена.`,
                      )
                    ) {
                      remove.mutate(acc.id);
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

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Send, Star } from "lucide-react";
import { errorMessage } from "../../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../../lib/outreach-queries";

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
  const navigate = useNavigate();
  const accounts = useOutreachAccounts(wsId);

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
              <li
                key={acc.id}
                className="flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-zinc-50"
                onClick={() =>
                  navigate({
                    to: "/w/$wsId/outreach/accounts/$accountId",
                    params: { wsId, accountId: acc.id },
                  })
                }
              >
                <span
                  className={
                    "h-2.5 w-2.5 shrink-0 rounded-full " +
                    (STATUS_COLOR[acc.status] ?? "bg-zinc-300")
                  }
                  title={STATUS_LABEL[acc.status] ?? acc.status}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span className="truncate font-medium">
                      {acc.firstName || acc.tgUsername || "Без имени"}
                    </span>
                    {acc.hasPremium && (
                      <Star
                        size={12}
                        className="shrink-0 fill-amber-400 text-amber-400"
                      />
                    )}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {acc.phoneNumber ?? null}
                    {acc.phoneNumber && acc.tgUsername ? " · " : null}
                    {acc.tgUsername ? `@${acc.tgUsername}` : null}
                  </div>
                </div>
                <ChevronRight size={16} className="shrink-0 text-zinc-400" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

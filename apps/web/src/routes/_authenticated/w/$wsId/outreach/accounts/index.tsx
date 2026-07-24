import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Plus, Send, Star } from "lucide-react";
import { errorMessage } from "../../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../../lib/outreach-queries";
import { PlatformBadge } from "../../../../../../lib/platforms";

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
        Отдельные аккаунты-отправители (Telegram, MAX) для холодных рассылок и
        парсинга каналов. Личные не используем — за массовую отправку с обычных
        аккаунтов площадки банят.
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
            Подключите хотя бы один аккаунт (Telegram или MAX), чтобы запускать
            рассылки и собирать статистику каналов.
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
                    <PlatformBadge platform={acc.platform} />
                    <span className="truncate font-medium">
                      {acc.firstName || acc.tgUsername || "Без имени"}
                    </span>
                    {acc.hasPremium && (
                      <Star
                        size={12}
                        className="shrink-0 fill-amber-400 text-amber-400"
                      />
                    )}
                    {acc.cooldownUntil &&
                      new Date(acc.cooldownUntil).getTime() > Date.now() && (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
                          title={acc.cooldownReason ?? "Telegram FloodWait"}
                        >
                          cooldown
                        </span>
                      )}
                    {/* Ограничение ПОИСКА (searchPublicChat) — отправкам не
                        мешает, лукапы юзернеймов идут другими аккаунтами. */}
                    {acc.searchFloodedUntil && (
                      <span
                        className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-800"
                        title={`TG ограничил поиск юзернеймов до ${new Date(acc.searchFloodedUntil).toLocaleString("ru")}. Отправки работают.`}
                      >
                        поиск огр.
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {acc.phoneNumber ?? null}
                    {acc.phoneNumber && acc.tgUsername ? " · " : null}
                    {acc.tgUsername ? `@${acc.tgUsername}` : null}
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    Сегодня новым: {acc.coldSentToday} / {acc.newLeadsDailyLimit}
                    <span className="text-zinc-400"> · 30д: {acc.coldSent30d}</span>
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

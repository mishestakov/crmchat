import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../../../lib/api";
import { errorMessage } from "../../../../lib/errors";
import { formatRelative } from "../../../../lib/date-utils";
import { SearchInput } from "../../../../components/search-input";

// Словарь РКН (T4.5): поиск по реестру страниц с Госуслуг. Главный сценарий —
// проверить блогера, которого ещё нет в CRM (по юзернейму/названию). Данные
// синкает rkn-registry worker раз в сутки; кнопки «Обновить» нет осознанно —
// видна дата последнего синка, а если синк падает — плашка с ошибкой.

export const Route = createFileRoute("/_authenticated/w/$wsId/rkn")({
  component: RknPage,
});

function RknPage() {
  const [q, setQ] = useState("");
  const [network, setNetwork] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  // Реестр глобальный (не workspace) — ручка /v1/rkn без wsId; страница живёт
  // в воркспейс-шелле только ради сайдбара.
  const listQ = useQuery({
    queryKey: ["rkn", q, network, page] as const,
    // Старые данные на экране, пока едет новая страница — таблица не мигает.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/rkn", {
        params: {
          query: {
            q: q || undefined,
            network: network ?? undefined,
            page,
          },
        },
      });
      if (error) throw error;
      return data!;
    },
  });

  const d = listQ.data;
  const pages = d ? Math.max(1, Math.ceil(d.filteredTotal / d.pageSize)) : 1;
  const syncFailed = d?.lastStatus && d.lastStatus !== "ok";

  return (
    <div className="p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">РКН-реестр</h1>
        <div className="text-xs text-zinc-500">
          {d?.lastSyncAt
            ? `Обновлено ${formatRelative(d.lastSyncAt)} · ${d.registryTotal.toLocaleString("ru")} записей · автообновление раз в сутки`
            : "Реестр ещё не загружен — первый синк идёт несколько минут"}
        </div>
      </div>
      {syncFailed && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
          Последняя попытка обновления не удалась: {d!.lastStatus} — показаны
          данные на {d?.lastSyncAt ? formatRelative(d.lastSyncAt) : "—"}.
        </div>
      )}
      <div className="mb-3 mt-3 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Юзернейм, ссылка или название страницы…"
        />
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <NetworkChip
          label="Все"
          active={network === null}
          onClick={() => {
            setNetwork(null);
            setPage(1);
          }}
        />
        {(d?.networks ?? []).map((n) => (
          <NetworkChip
            key={n.network}
            label={`${n.network} ${n.count.toLocaleString("ru")}`}
            active={network === n.network}
            onClick={() => {
              setNetwork(n.network);
              setPage(1);
            }}
          />
        ))}
      </div>
      {listQ.error && (
        <p className="text-sm text-red-600">{errorMessage(listQ.error)}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wider text-zinc-500">
              <th className="px-3 py-2">Соцсеть</th>
              <th className="px-3 py-2">Страница</th>
              <th className="px-3 py-2">Название</th>
              <th className="px-3 py-2">Статус</th>
            </tr>
          </thead>
          <tbody>
            {(d?.records ?? []).map((r) => (
              <tr key={r.uid} className="border-b border-zinc-100">
                <td className="px-3 py-1.5 text-zinc-600">{r.network}</td>
                <td className="px-3 py-1.5">
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-700 hover:underline"
                  >
                    {r.url.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                </td>
                <td className="max-w-md truncate px-3 py-1.5">
                  {r.title ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-xs text-zinc-500">
                  {r.status === "active" ? "действует" : r.status}
                </td>
              </tr>
            ))}
            {d && d.records.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  Ничего не нашлось
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {d && pages > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40"
          >
            ←
          </button>
          <span className="text-zinc-500">
            {page} / {pages} · найдено {d.filteredTotal.toLocaleString("ru")}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 disabled:opacity-40"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

function NetworkChip(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors " +
        (props.active
          ? "bg-zinc-900 text-white ring-zinc-900"
          : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")
      }
    >
      {props.label}
    </button>
  );
}

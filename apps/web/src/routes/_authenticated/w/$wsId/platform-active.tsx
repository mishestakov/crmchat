import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../../../lib/api";
import { errorMessage } from "../../../../lib/errors";
import { formatRelative } from "../../../../lib/date-utils";
import { externalHref } from "../../../../lib/external-href";
import { SearchInput } from "../../../../components/search-input";
import { PLATFORMS, type Platform } from "../../../../lib/platforms";
import { FilterChip } from "../../../../components/filter-chip";

// Справочник «Каналы Яндекса» (см. specs/yt-platform-active.md): каналы, уже
// крутящиеся на рекл-платформах Яндекса (CPC=tgads/CPA=cpa_network). Питает
// бейдж «работает на платформе» на лиде + будущий win-back. Зеркало страницы РКН:
// датасет глобальный (/v1/platform-active без wsId), синк гонит внешний
// python-джоб раз в сутки; кнопки «Обновить» нет — видна дата последнего синка.

export const Route = createFileRoute("/_authenticated/w/$wsId/platform-active")({
  component: PlatformActivePage,
});

// Метка/ссылка платформы — из общего конфига lib/platforms (не дублируем).
// platform приходит строкой из API; домен гарантирован CHECK'ом в БД, но
// lookup делаем мягким на случай неизвестного значения.
const platformInfo = (platform: string) =>
  PLATFORMS[platform as Platform] as
    | { label: string; url: (handle: string) => string }
    | undefined;

function PlatformActivePage() {
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [cpvOnly, setCpvOnly] = useState(false);
  const [page, setPage] = useState(1);

  const listQ = useQuery({
    queryKey: ["platform-active", q, platform, source, cpvOnly, page] as const,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/platform-active", {
        params: {
          query: {
            q: q || undefined,
            platform: platform ?? undefined,
            source: source ?? undefined,
            cpv: cpvOnly ? "true" : undefined,
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
        <h1 className="text-xl font-semibold">Каналы Яндекса</h1>
        <div className="text-xs text-zinc-500">
          {d?.lastSyncAt
            ? `Обновлено ${formatRelative(d.lastSyncAt)} · ${d.registryTotal.toLocaleString("ru")} записей · автообновление раз в сутки`
            : "Датасет ещё не загружен — синк идёт раз в сутки"}
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
          placeholder="Юзернейм, ссылка или логин владельца…"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={cpvOnly}
            onChange={(e) => {
              setCpvOnly(e.target.checked);
              setPage(1);
            }}
          />
          только CPV-качество
        </label>
      </div>

      {/* Система (CPC/CPA) */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        <FilterChip
          label="Все системы"
          active={source === null}
          onClick={() => {
            setSource(null);
            setPage(1);
          }}
        />
        {(d?.sources ?? []).map((s) => (
          <FilterChip
            key={s.source}
            label={`${s.source.toUpperCase()} ${s.count.toLocaleString("ru")}`}
            active={source === s.source}
            onClick={() => {
              setSource(s.source);
              setPage(1);
            }}
          />
        ))}
      </div>
      {/* Платформа */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip
          label="Все платформы"
          active={platform === null}
          onClick={() => {
            setPlatform(null);
            setPage(1);
          }}
        />
        {(d?.platforms ?? []).map((p) => (
          <FilterChip
            key={p.platform}
            label={`${platformInfo(p.platform)?.label ?? p.platform} ${p.count.toLocaleString("ru")}`}
            active={platform === p.platform}
            onClick={() => {
              setPlatform(p.platform);
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
              <th className="px-3 py-2">Платформа</th>
              <th className="px-3 py-2">Система</th>
              <th className="px-3 py-2">Канал</th>
              <th className="px-3 py-2">Статус</th>
              <th className="px-3 py-2">CPV</th>
              <th className="px-3 py-2">Последний пост</th>
              <th className="px-3 py-2 text-right">Постов 60д</th>
              <th className="px-3 py-2 text-right">Просмотры 60д</th>
            </tr>
          </thead>
          <tbody>
            {(d?.records ?? []).map((r) => {
              const href = channelHref(r);
              const label = channelLabel(r);
              return (
              <tr key={r.sourceKey} className="border-b border-zinc-100">
                <td className="px-3 py-1.5 text-zinc-600">
                  {platformInfo(r.platform)?.label ?? r.platform}
                </td>
                <td className="px-3 py-1.5 text-xs font-medium text-zinc-500">
                  {r.source.toUpperCase()}
                </td>
                <td className="px-3 py-1.5">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-700 hover:underline"
                    >
                      {label}
                    </a>
                  ) : (
                    <span className="text-zinc-700">{label}</span>
                  )}
                  {r.ownerLogin && (
                    <span className="ml-1.5 text-xs text-zinc-400">
                      @{r.ownerLogin}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <StatusBadge record={r} />
                </td>
                <td className="px-3 py-1.5 text-zinc-500">
                  {r.isCpv ? "✓" : ""}
                </td>
                <td className="px-3 py-1.5 text-xs text-zinc-500">
                  {r.lastPostDate ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">
                  {r.recentPostsCount.toLocaleString("ru")}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-zinc-600">
                  {r.recentViews.toLocaleString("ru")}
                </td>
              </tr>
              );
            })}
            {d && d.records.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">
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

// Статус-бейдж: для CPC показываем здоровье бота (+ неактивность), для CPA —
// этап модерации. Проблемные состояния — янтарём (кандидаты на win-back).
function StatusBadge(props: {
  record: {
    source: string;
    botStatus: string | null;
    isActive: boolean | null;
    moderationStatus: string | null;
  };
}) {
  const r = props.record;
  if (r.source === "cpc") {
    if (r.botStatus && r.botStatus !== "OK") return <Badge tone="warn">{r.botStatus}</Badge>;
    if (r.isActive === false) return <Badge tone="warn">неактивен</Badge>;
    return <Badge tone="ok">OK</Badge>;
  }
  if (r.moderationStatus) return <Badge tone="muted">{r.moderationStatus}</Badge>;
  return <span className="text-zinc-300">—</span>;
}

function Badge(props: { tone: "ok" | "warn" | "muted"; children: string }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    muted: "bg-zinc-50 text-zinc-600 ring-zinc-200",
  }[props.tone];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}
    >
      {props.children}
    </span>
  );
}

function channelLabel(r: { username: string | null; link: string | null }): string {
  if (r.username) return `@${r.username}`;
  if (r.link) return r.link.replace(/^https?:\/\/(www\.)?/, "");
  return "—";
}

function channelHref(r: {
  platform: string;
  username: string | null;
  link: string | null;
}): string | null {
  if (r.username) {
    const built = platformInfo(r.platform)?.url(r.username);
    if (built) return built;
  }
  if (r.link) return externalHref(r.link);
  return null;
}


import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";

// Двух-панельный tree-explorer: «папка» (track) → дети (project), слева в layout.
// Общий каркас для BD (projects/route) и agency (campaigns/route): поиск,
// группировка по trackId, collapse-состояние, scaffold (search-box, заголовок
// секции, кнопка «новая папка», loading/empty, скролл). Различия (лейблы,
// иконки, СТРУКТУРА кликабельных рядов и типизированные <Link>) отдаются
// вызывающему через render-props — так роуты сохраняют свои типобезопасные
// маршруты, а дублируется только их JSX-обёртка, не логика.

type TrackLike = { id: string; name: string };
type ItemLike = { id: string; trackId: string; name: string };

export function EntityTree<T extends ItemLike>(props: {
  tracks: TrackLike[];
  items: T[];
  isLoading: boolean;
  sectionLabel: string;
  emptyText: string;
  newButton: {
    label: string;
    icon: ReactNode;
    onClick: () => void;
    disabled?: boolean;
  };
  // Ряд-папка целиком (caller рисует chevron/иконку/имя через данные ctx) — BD
  // это кнопка-тоггл, agency это chevron + Link на карточку клиента.
  renderTrackRow: (
    track: TrackLike,
    ctx: { isCollapsed: boolean; toggle: () => void; count: number },
  ) => ReactNode;
  // Дочерний элемент (типизированный <Link key=…>) и строка «новый …».
  renderChild: (item: T) => ReactNode;
  renderNewChild: (trackId: string) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Группировка items по trackId. Поиск фильтрует по имени item'а или папки.
  const byTrack = useMemo(() => {
    const term = query.trim().toLowerCase();
    const map = new Map<string, T[]>();
    for (const t of props.tracks) map.set(t.id, []);
    for (const p of props.items) {
      if (term) {
        const trackName =
          props.tracks.find((t) => t.id === p.trackId)?.name ?? "";
        if (
          !p.name.toLowerCase().includes(term) &&
          !trackName.toLowerCase().includes(term)
        ) {
          continue;
        }
      }
      const arr = map.get(p.trackId);
      if (arr) arr.push(p);
      else map.set(p.trackId, [p]);
    }
    return map;
  }, [props.tracks, props.items, query]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 p-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск..."
            className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          <span>{props.sectionLabel}</span>
          <button
            type="button"
            onClick={props.newButton.onClick}
            disabled={props.newButton.disabled}
            className="flex items-center gap-0.5 normal-case tracking-normal text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
          >
            {props.newButton.icon} {props.newButton.label}
          </button>
        </div>

        {props.isLoading && (
          <div className="px-2 py-1 text-xs text-zinc-400">Загрузка…</div>
        )}
        {!props.isLoading && props.tracks.length === 0 && (
          <div className="px-2 py-1 text-xs text-zinc-500">{props.emptyText}</div>
        )}

        {props.tracks.map((track) => {
          const isCollapsed = collapsed.has(track.id);
          const trackItems = byTrack.get(track.id) ?? [];
          // При активном поиске прячем пустые папки.
          if (query && trackItems.length === 0) return null;
          return (
            <div key={track.id} className="mb-0.5">
              {props.renderTrackRow(track, {
                isCollapsed,
                toggle: () => toggle(track.id),
                count: trackItems.length,
              })}
              {!isCollapsed && (
                <div className="ml-4 mt-0.5 border-l border-zinc-100 pl-2">
                  {trackItems.map((item) => props.renderChild(item))}
                  {props.renderNewChild(track.id)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

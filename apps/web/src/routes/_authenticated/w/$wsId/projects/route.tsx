import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Briefcase, ChevronDown, ChevronRight, FolderPlus, Plus, Search } from "lucide-react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useMyRole } from "../../../../../lib/hooks";
import { getLastProjectView } from "../../../../../lib/last-project-view";
import { OUTREACH_QK } from "../../../../../lib/query-keys";

// Двух-панельный explorer проектов: tree Track→Project слева, страница
// активного проекта справа (через <Outlet/>). Layout активен на всех путях
// /w/$wsId/projects/* — даже при переходе в детальный URL левая панель
// остаётся.

export const Route = createFileRoute("/_authenticated/w/$wsId/projects")({
  component: ProjectsLayout,
});

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-300",
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  done: "bg-zinc-400",
};

function ProjectsLayout() {
  const { wsId } = Route.useParams();
  const isAdmin = useMyRole(wsId) === "admin";
  const location = useLocation();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const createTrack = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/tracks",
        {
          params: { path: { wsId } },
          body: { name, kind: "program" },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.tracks(wsId) }),
  });

  const handleNewTrack = () => {
    const name = window.prompt("Название папки:");
    if (!name || !name.trim()) return;
    createTrack.mutate(name.trim(), {
      onError: (e) => alert("Ошибка: " + errorMessage(e)),
    });
  };

  const tracksQ = useQuery({
    queryKey: OUTREACH_QK.tracks(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/tracks",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const projectsQ = useQuery({
    queryKey: OUTREACH_QK.projects(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // Активный projectId из URL: /w/$wsId/projects/$projectId/...
  const activeProjectId = useMemo(() => {
    const m = location.pathname.match(/\/projects\/([^/]+)/);
    if (!m) return null;
    if (m[1] === "new") return null;
    return m[1];
  }, [location.pathname]);

  const tracks = tracksQ.data ?? [];
  const projects = projectsQ.data ?? [];

  // Группировка projects по trackId. Поиск фильтрует по имени проекта или треку.
  const byTrack = useMemo(() => {
    const term = query.trim().toLowerCase();
    const map = new Map<string, typeof projects>();
    for (const t of tracks) map.set(t.id, []);
    for (const p of projects) {
      if (term) {
        const trackName = tracks.find((t) => t.id === p.trackId)?.name ?? "";
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
  }, [tracks, projects, query]);

  const toggle = (trackId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  return (
    <div className="flex h-screen">
      {/* Tree-explorer */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 p-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск..."
              className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            <span>Папки</span>
            {isAdmin && (
              <button
                type="button"
                onClick={handleNewTrack}
                disabled={createTrack.isPending}
                className="flex items-center gap-0.5 normal-case tracking-normal text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
                title="Новая папка"
              >
                <FolderPlus size={11} /> папка
              </button>
            )}
          </div>

          {tracksQ.isLoading && (
            <div className="px-2 py-1 text-xs text-zinc-400">Загрузка…</div>
          )}

          {!tracksQ.isLoading && tracks.length === 0 && (
            <div className="px-2 py-1 text-xs text-zinc-500">
              Нет папок. {isAdmin && "Создай первую кнопкой «папка» вверху."}
            </div>
          )}

          {tracks.map((track) => {
            const isCollapsed = collapsed.has(track.id);
            const trackProjects = byTrack.get(track.id) ?? [];
            // При активном поиске прячем пустые треки.
            if (query && trackProjects.length === 0) return null;
            return (
              <div key={track.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => toggle(track.id)}
                  className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} className="text-zinc-400" />
                  ) : (
                    <ChevronDown size={14} className="text-zinc-400" />
                  )}
                  <Briefcase size={13} className="text-zinc-400" />
                  <span className="truncate font-medium">{track.name}</span>
                  <span className="ml-auto text-xs text-zinc-400">
                    {trackProjects.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="ml-4 mt-0.5 border-l border-zinc-100 pl-2">
                    {trackProjects.map((p) => (
                      <Link
                        key={p.id}
                        to={
                          p.status === "draft"
                            ? "/w/$wsId/projects/$projectId"
                            : getLastProjectView(p.id) === "kanban"
                              ? "/w/$wsId/projects/$projectId/kanban"
                              : "/w/$wsId/projects/$projectId/leads"
                        }
                        params={{ wsId, projectId: p.id }}
                        className={
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50 " +
                          (activeProjectId === p.id
                            ? "bg-emerald-50 text-emerald-900"
                            : "text-zinc-700")
                        }
                      >
                        <span
                          className={
                            "h-1.5 w-1.5 shrink-0 rounded-full " +
                            (STATUS_COLORS[p.status] ?? "bg-zinc-300")
                          }
                        />
                        <span className="truncate">{p.name}</span>
                      </Link>
                    ))}
                    {isAdmin && (
                      <Link
                        to="/w/$wsId/projects/new"
                        params={{ wsId }}
                        search={{ trackId: track.id }}
                        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-emerald-700"
                      >
                        <Plus size={11} /> Новый проект
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Правая панель — выбранный проект. overflow-y-auto делает scroll
          локальным: длинная страница проекта не утягивает за собой
          tree-sidebar слева. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-50">
        <Outlet />
      </main>
    </div>
  );
}

import {
  Link,
  Outlet,
  createFileRoute,
  useLocation,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Briefcase, ChevronDown, ChevronRight, FolderPlus, Plus } from "lucide-react";
import { UnreadBadge } from "../../../../../components/unread-badge";
import { EntityTree } from "../../../../../components/entity-tree";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import { getLastProjectView } from "../../../../../lib/last-project-view";
import { OUTREACH_QK } from "../../../../../lib/query-keys";

// Двух-панельный explorer проектов: tree Track→Project слева (общий EntityTree),
// страница активного проекта справа (через <Outlet/>). Layout активен на всех
// путях /w/$wsId/projects/* — левая панель остаётся при переходе в детальный URL.

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
  const location = useLocation();
  const qc = useQueryClient();

  const createTrack = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
        body: { name },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OUTREACH_QK.tracks(wsId) }),
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
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const projectsQ = useQuery({
    queryKey: OUTREACH_QK.projects(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/projects", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  // Debounced invalidate /projects на любое contact-событие (input/read/delete).
  // Без дебаунса пачка inbound'ов от worker'а ударит 50 refetch'ей подряд.
  const invalidateTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
      }
    },
    [],
  );
  useEventSourceEvent(`/v1/workspaces/${wsId}/contact-stream`, "contact", () => {
    if (invalidateTimerRef.current !== null) {
      window.clearTimeout(invalidateTimerRef.current);
    }
    invalidateTimerRef.current = window.setTimeout(() => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
      invalidateTimerRef.current = null;
    }, 500);
  });

  // Активный projectId из URL: /w/$wsId/projects/$projectId/...
  const activeProjectId = useMemo(() => {
    const m = location.pathname.match(/\/projects\/([^/]+)/);
    if (!m || m[1] === "new") return null;
    return m[1];
  }, [location.pathname]);

  return (
    <div className="flex h-screen">
      <EntityTree
        tracks={tracksQ.data ?? []}
        items={projectsQ.data ?? []}
        isLoading={tracksQ.isLoading}
        sectionLabel="Папки"
        emptyText="Нет папок. Создай первую кнопкой «папка» вверху."
        newButton={{
          label: "папка",
          icon: <FolderPlus size={11} />,
          onClick: handleNewTrack,
          disabled: createTrack.isPending,
        }}
        renderTrackRow={(track, { isCollapsed, toggle, count }) => (
          <button
            type="button"
            onClick={toggle}
            className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
          >
            {isCollapsed ? (
              <ChevronRight size={14} className="text-zinc-400" />
            ) : (
              <ChevronDown size={14} className="text-zinc-400" />
            )}
            <Briefcase size={13} className="text-zinc-400" />
            <span className="truncate font-medium">{track.name}</span>
            <span className="ml-auto text-xs text-zinc-400">{count}</span>
          </button>
        )}
        renderChild={(p) => (
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
            {(p.status === "active" || p.status === "paused") &&
              (p.unreadCount > 0 || p.hasMarkedUnread) && (
                <span
                  className="ml-auto"
                  title={
                    p.unreadCount > 0
                      ? `${p.unreadCount} непрочитанных`
                      : "Есть диалог, помеченный непрочитанным"
                  }
                >
                  <UnreadBadge count={p.unreadCount} dot={p.hasMarkedUnread} />
                </span>
              )}
          </Link>
        )}
        renderNewChild={(trackId) => (
          <Link
            to="/w/$wsId/projects/new"
            params={{ wsId }}
            search={{ trackId }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-emerald-700"
          >
            <Plus size={11} /> Новый проект
          </Link>
        )}
      />

      {/* Правая панель — выбранный проект. overflow-y-auto делает scroll
          локальным: длинная страница проекта не утягивает tree-sidebar. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-50">
        <Outlet />
      </main>
    </div>
  );
}

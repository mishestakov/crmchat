import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Building2, ChevronDown, ChevronRight, Plus, UserPlus } from "lucide-react";
import { EntityTree } from "../../../../../components/entity-tree";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// Двух-панельный explorer агентского флоу: tree Клиент(track)→Кампания(project)
// слева (общий EntityTree), активная страница справа через <Outlet/>. Отличие от
// projects/route: «папка» — это Клиент с карточкой реквизитов (имя клиента —
// Link на /campaigns/client/$clientId, а не просто сворачивание узла).

export const Route = createFileRoute("/_authenticated/w/$wsId/campaigns")({
  component: CampaignsLayout,
});

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-300",
  active: "bg-emerald-500",
  paused: "bg-amber-500",
  done: "bg-zinc-400",
};

function CampaignsLayout() {
  const { wsId } = Route.useParams();
  const location = useLocation();
  const qc = useQueryClient();

  const clientsQ = useQuery({
    queryKey: ["tracks", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/projects", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  const createClient = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
        body: { name },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tracks", wsId] }),
  });
  const handleNewClient = () => {
    const name = window.prompt("Название клиента:");
    if (!name || !name.trim()) return;
    createClient.mutate(name.trim(), {
      onError: (e) => alert("Ошибка: " + errorMessage(e)),
    });
  };

  const activeId = useMemo(() => {
    const m = location.pathname.match(/\/campaigns\/([^/]+)/);
    if (!m || m[1] === "new" || m[1] === "client") return null;
    return m[1];
  }, [location.pathname]);

  return (
    <div className="flex h-screen">
      <EntityTree
        tracks={clientsQ.data ?? []}
        items={campaignsQ.data ?? []}
        isLoading={clientsQ.isLoading}
        sectionLabel="Клиенты"
        emptyText="Нет клиентов. Создайте первого кнопкой «клиент»."
        newButton={{
          label: "клиент",
          icon: <UserPlus size={11} />,
          onClick: handleNewClient,
          disabled: createClient.isPending,
        }}
        renderTrackRow={(client, { isCollapsed, toggle, count }) => (
          <div className="flex items-center">
            <button
              type="button"
              onClick={toggle}
              className="p-1 text-zinc-400 hover:text-zinc-700"
              title={isCollapsed ? "Развернуть" : "Свернуть"}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            <Link
              to="/w/$wsId/campaigns/client/$clientId"
              params={{ wsId, clientId: client.id }}
              className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-sm hover:bg-zinc-50"
              activeProps={{ className: "bg-emerald-50 text-emerald-900" }}
            >
              <Building2 size={13} className="shrink-0 text-zinc-400" />
              <span className="truncate font-medium">{client.name}</span>
              <span className="ml-auto text-xs text-zinc-400">{count}</span>
            </Link>
          </div>
        )}
        renderChild={(p) => (
          <Link
            key={p.id}
            to="/w/$wsId/campaigns/$campaignId"
            params={{ wsId, campaignId: p.id }}
            className={
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50 " +
              (activeId === p.id
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
        )}
        renderNewChild={(clientId) => (
          <Link
            to="/w/$wsId/campaigns/new"
            params={{ wsId }}
            search={{ clientId }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-emerald-700"
          >
            <Plus size={11} /> Новая кампания
          </Link>
        )}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-50">
        <Outlet />
      </main>
    </div>
  );
}

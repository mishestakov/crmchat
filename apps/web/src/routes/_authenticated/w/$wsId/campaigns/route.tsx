import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Plus,
  Search,
  UserPlus,
} from "lucide-react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";

// Двух-панельный explorer агентского флоу: tree Клиент(track)→Кампания(project)
// слева, активная страница справа через <Outlet/>. Аналог projects/route.tsx,
// но «папка» — это Клиент с карточкой реквизитов (клик по имени клиента ведёт
// на /campaigns/client/$clientId, а не просто сворачивает узел).

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
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

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
      // kind='client' проставляется автоматом из workspace.mode='agency'.
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

  const clients = clientsQ.data ?? [];
  const campaigns = campaignsQ.data ?? [];

  const activeId = useMemo(() => {
    const m = location.pathname.match(/\/campaigns\/([^/]+)/);
    if (!m || m[1] === "new" || m[1] === "client") return null;
    return m[1];
  }, [location.pathname]);

  const byClient = useMemo(() => {
    const term = query.trim().toLowerCase();
    const map = new Map<string, typeof campaigns>();
    for (const c of clients) map.set(c.id, []);
    for (const p of campaigns) {
      if (term) {
        const clientName = clients.find((c) => c.id === p.trackId)?.name ?? "";
        if (
          !p.name.toLowerCase().includes(term) &&
          !clientName.toLowerCase().includes(term)
        ) {
          continue;
        }
      }
      const arr = map.get(p.trackId);
      if (arr) arr.push(p);
      else map.set(p.trackId, [p]);
    }
    return map;
  }, [clients, campaigns, query]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="flex h-screen">
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
            <span>Клиенты</span>
            <button
              type="button"
              onClick={handleNewClient}
              disabled={createClient.isPending}
              className="flex items-center gap-0.5 normal-case tracking-normal text-zinc-500 hover:text-zinc-900 disabled:opacity-50"
              title="Новый клиент"
            >
              <UserPlus size={11} /> клиент
            </button>
          </div>

          {clientsQ.isLoading && (
            <div className="px-2 py-1 text-xs text-zinc-400">Загрузка…</div>
          )}
          {!clientsQ.isLoading && clients.length === 0 && (
            <div className="px-2 py-1 text-xs text-zinc-500">
              Нет клиентов. Создайте первого кнопкой «клиент».
            </div>
          )}

          {clients.map((client) => {
            const isCollapsed = collapsed.has(client.id);
            const clientCampaigns = byClient.get(client.id) ?? [];
            if (query && clientCampaigns.length === 0) return null;
            return (
              <div key={client.id} className="mb-0.5">
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => toggle(client.id)}
                    className="p-1 text-zinc-400 hover:text-zinc-700"
                    title={isCollapsed ? "Развернуть" : "Свернуть"}
                  >
                    {isCollapsed ? (
                      <ChevronRight size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                  </button>
                  <Link
                    to="/w/$wsId/campaigns/client/$clientId"
                    params={{ wsId, clientId: client.id }}
                    className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-sm hover:bg-zinc-50"
                    activeProps={{ className: "bg-emerald-50 text-emerald-900" }}
                  >
                    <Building2 size={13} className="shrink-0 text-zinc-400" />
                    <span className="truncate font-medium">{client.name}</span>
                    <span className="ml-auto text-xs text-zinc-400">
                      {clientCampaigns.length}
                    </span>
                  </Link>
                </div>
                {!isCollapsed && (
                  <div className="ml-5 mt-0.5 border-l border-zinc-100 pl-2">
                    {clientCampaigns.map((p) => (
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
                    ))}
                    <Link
                      to="/w/$wsId/campaigns/new"
                      params={{ wsId }}
                      search={{ clientId: client.id }}
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-emerald-700"
                    >
                      <Plus size={11} /> Новая кампания
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-50">
        <Outlet />
      </main>
    </div>
  );
}

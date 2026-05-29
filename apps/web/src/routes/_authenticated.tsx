import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "../lib/api";

const meQueryOptions = {
  queryKey: ["me"] as const,
  queryFn: async () => {
    const { data, error, response } = await api.GET("/v1/auth/me");
    if (response.status === 401) return null;
    if (error) throw error;
    return data;
  },
};

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(meQueryOptions);
    if (!me) throw redirect({ to: "/login" });
  },
  component: AuthLayout,
});

// Свёрнутость глобального сайдбара. Состояние общее для всех страниц (паттерн
// collapsible sidebar) и переживает переходы — храним в localStorage.
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1",
  );
  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}

function AuthLayout() {
  const params = useParams({ strict: false }) as { wsId?: string };
  const wsId = params.wsId;
  const [collapsed, setCollapsed] = useSidebarCollapsed();

  // mode текущего ws — для sidebar-сплита bd/agency. Берём из того же
  // списка воркспейсов, что грузит WorkspaceSwitcher (общий кеш).
  const wsList = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
  });
  const mode = wsList.data?.find((w) => w.id === wsId)?.mode;

  return (
    <div className="flex h-screen bg-zinc-100">
      <aside
        className={
          "flex shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 " +
          (collapsed ? "w-14" : "w-60")
        }
      >
        <div
          className={
            "flex items-center border-b border-zinc-200 p-2 " +
            (collapsed ? "justify-center" : "justify-end")
          }
        >
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        {collapsed ? null : (
          <>
        <WorkspaceSwitcher currentWsId={wsId} />
        <nav className="flex-1 space-y-4 overflow-y-auto p-3 text-sm">
          {wsId && (
            <>
              <SidebarGroup title="База">
                {/* «Листать всех людей» убрано в обоих режимах: оба
                    канало-центричны, всё про админа живёт на канале. Карточка
                    контакта (/contacts/$id) остаётся — на неё deep-link из
                    канала/канбана/лидов. */}
                <SidebarLink to="/w/$wsId/channels" wsId={wsId}>
                  Каналы
                </SidebarLink>
              </SidebarGroup>
              <SidebarGroup title="Работа">
                {/* Sidebar-сплит по workspace.mode: agency → «Кампании»
                    (медиаплан-визард), bd → «Проекты» (канбан-аутрич).
                    Один проект не должен иметь два входа с разным UI. */}
                {mode === "agency" ? (
                  <SidebarLink to="/w/$wsId/campaigns" wsId={wsId}>
                    Кампании
                  </SidebarLink>
                ) : (
                  <SidebarLink to="/w/$wsId/projects" wsId={wsId}>
                    Проекты
                  </SidebarLink>
                )}
                <SidebarLink to="/w/$wsId/outreach/accounts" wsId={wsId}>
                  Telegram-аккаунты
                </SidebarLink>
                <SidebarLink to="/w/$wsId/outreach/schedule" wsId={wsId}>
                  Расписание
                </SidebarLink>
              </SidebarGroup>
              <SidebarGroup title="Конфигурация">
                <SidebarLink to="/w/$wsId/settings" wsId={wsId}>
                  Настройки
                </SidebarLink>
              </SidebarGroup>
            </>
          )}
        </nav>
        <SidebarFooter />
          </>
        )}
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function WorkspaceSwitcher({ currentWsId }: { currentWsId?: string }) {
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="border-b border-zinc-200 p-3">
      <select
        value={currentWsId ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          if (id)
            navigate({
              to: "/w/$wsId/channels",
              params: { wsId: id },
            });
        }}
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
      >
        {!currentWsId && <option value="">— выбрать workspace —</option>}
        {list.data?.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <Link
        to="/"
        search={{ new: true }}
        className="mt-2 block text-xs text-zinc-500 hover:text-zinc-900"
      >
        + Создать workspace
      </Link>
    </div>
  );
}

function SidebarGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function SidebarLink(props: {
  to:
    | "/w/$wsId/contacts"
    | "/w/$wsId/channels"
    | "/w/$wsId/settings"
    | "/w/$wsId/outreach/accounts"
    | "/w/$wsId/projects"
    | "/w/$wsId/campaigns"
    | "/w/$wsId/outreach/schedule";
  wsId: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={props.to}
      params={{ wsId: props.wsId }}
      className="block rounded px-2 py-1.5 text-zinc-700 hover:bg-zinc-100"
      activeProps={{
        className: "block rounded px-2 py-1.5 bg-zinc-100 font-medium text-zinc-900",
      }}
      activeOptions={{ exact: false }}
    >
      {props.children}
    </Link>
  );
}

function SidebarFooter() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const me = useQuery(meQueryOptions);

  const logout = useMutation({
    mutationFn: async () => {
      await api.POST("/v1/auth/logout");
    },
    onSuccess: () => {
      qc.clear();
      navigate({ to: "/login" });
    },
  });

  return (
    <div className="space-y-2 border-t border-zinc-200 p-3 text-sm">
      <div className="truncate text-xs text-zinc-500">
        {me.data ? me.data.name ?? me.data.username ?? me.data.id : "…"}
      </div>
      {import.meta.env.DEV && me.data?.hasAdminRole && (
        <DevUserSwitcher currentUserId={me.data?.id} />
      )}
      <button
        onClick={() => logout.mutate()}
        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-left hover:bg-zinc-50"
      >
        Выйти
      </button>
    </div>
  );
}

function DevUserSwitcher({ currentUserId }: { currentUserId?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const devUsers = useQuery({
    queryKey: ["devUsers"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/_dev/users");
      if (error) throw error;
      return data;
    },
  });
  const switchUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST("/v1/_dev/login", { body: { userId } });
      if (error) throw error;
    },
    onSuccess: async () => {
      await navigate({ to: "/", search: { new: false } });
      qc.invalidateQueries();
    },
  });
  return (
    <select
      value={currentUserId ?? ""}
      onChange={(e) => switchUser.mutate(e.target.value)}
      className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
      title="Сменить dev-юзера"
    >
      {devUsers.data?.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.id}
        </option>
      ))}
    </select>
  );
}

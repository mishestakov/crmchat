import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
    // Прогреваем кэш — useQuery ниже возьмёт результат отсюда без второго запроса.
    const me = await context.queryClient.fetchQuery(meQueryOptions);
    if (!me) throw redirect({ to: "/login" });
  },
  component: AuthLayout,
});

function AuthLayout() {
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
    <div>
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3">
        <div className="text-sm text-zinc-700">
          {me.data ? `${me.data.name ?? me.data.email}` : "…"}
        </div>
        <div className="flex items-center gap-3">
          {import.meta.env.DEV && <DevUserSwitcher currentUserId={me.data?.id} />}
          <button
            onClick={() => logout.mutate()}
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100"
          >
            Выйти
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

// Dev-only: быстрое переключение между сидированными юзерами.
// В prod-сборке (`vite build`) ветка не попадёт в бандл — DCE по `import.meta.env.DEV`.
function DevUserSwitcher({ currentUserId }: { currentUserId?: string }) {
  const qc = useQueryClient();
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
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <select
      value={currentUserId ?? ""}
      onChange={(e) => switchUser.mutate(e.target.value)}
      className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
      title="Сменить dev-юзера"
    >
      {devUsers.data?.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name ?? u.email}
        </option>
      ))}
    </select>
  );
}

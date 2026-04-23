import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const users = useQuery({
    queryKey: ["devUsers"],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/_dev/users");
      if (error) throw error;
      return data;
    },
  });

  const login = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await api.POST("/v1/_dev/login", { body: { userId } });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate({ to: "/" });
    },
  });

  return (
    <div className="mx-auto max-w-md p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Войти как</h1>
      <p className="text-sm text-zinc-500">
        Dev-режим: реального логина нет, выбираешь юзера из списка.
      </p>

      {users.isLoading && <p>Загрузка…</p>}
      {users.error && (
        <p className="text-red-600">{errorMessage(users.error)}</p>
      )}
      {users.data && (
        <ul className="space-y-2">
          {users.data.map((u) => (
            <li key={u.id}>
              <button
                onClick={() => login.mutate(u.id)}
                disabled={login.isPending}
                className="w-full rounded border border-zinc-300 p-3 text-left hover:bg-zinc-100 disabled:opacity-50"
              >
                <div className="font-medium">{u.name ?? u.email}</div>
                <div className="text-xs text-zinc-500">{u.email}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

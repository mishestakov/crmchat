import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "../../lib/api";
import { errorMessage } from "../../lib/errors";

const workspacesQueryOptions = {
  queryKey: ["workspaces"] as const,
  queryFn: async () => {
    const { data, error } = await api.GET("/v1/workspaces");
    if (error) throw error;
    return data;
  },
};

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (s: Record<string, unknown>) => ({
    new: s.new === true || s.new === "1" || s.new === "true",
  }),
  beforeLoad: async ({ context, search }) => {
    // ?new=1 → намеренно показываем форму создания, redirect не делаем.
    if (search.new) return;
    // Иначе (default landing) — если уже есть workspace, ведём в него.
    const ws = await context.queryClient.fetchQuery(workspacesQueryOptions);
    if (ws.length > 0) {
      throw redirect({
        to: "/w/$wsId/contacts",
        params: { wsId: ws[0]!.id },
      });
    }
  },
  component: CreateWorkspacePage,
});

function CreateWorkspacePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Если у юзера уже есть воркспейсы — показываем «← Назад» на первый.
  // Если 0 (первый вход после регистрации) — кнопки нет, это обязательный
  // шаг онбординга. Данные уже в кеше от beforeLoad'а.
  const wsListQ = useQuery({
    queryKey: ["workspaces"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces");
      if (error) throw error;
      return data;
    },
  });
  const existingWs = wsListQ.data?.[0];

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/v1/workspaces", {
        body: { name },
      });
      if (error) throw error;
      return data!;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      navigate({ to: "/w/$wsId/contacts", params: { wsId: data.id } });
    },
  });

  const [name, setName] = useState("");
  const canSubmit = name.trim().length > 0 && !create.isPending;

  return (
    <div className="mx-auto max-w-md p-8 space-y-6">
      {existingWs && (
        <button
          type="button"
          onClick={() =>
            navigate({
              to: "/w/$wsId/contacts",
              params: { wsId: existingWs.id },
            })
          }
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"
        >
          <ArrowLeft size={14} />
          Назад
        </button>
      )}
      <h1 className="text-2xl font-semibold">Создать workspace</h1>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) create.mutate(name.trim());
        }}
      >
        <input
          autoFocus
          className="w-full rounded border border-zinc-300 px-3 py-2"
          placeholder="Название workspace"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Создать
        </button>
        {create.error && (
          <p className="text-sm text-red-600">{errorMessage(create.error)}</p>
        )}
      </form>
    </div>
  );
}

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
    mutationFn: async (input: { name: string; mode: "bd" | "agency" }) => {
      const { data, error } = await api.POST("/v1/workspaces", {
        body: input,
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
  // mode выбирается явно при создании, дефолта нет — это первичный продуктовый
  // тумблер (bd vs agency). Менять mode после создания нельзя.
  const [mode, setMode] = useState<"bd" | "agency" | null>(null);
  const canSubmit = name.trim().length > 0 && mode !== null && !create.isPending;

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
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && mode) create.mutate({ name: name.trim(), mode });
        }}
      >
        <input
          autoFocus
          className="w-full rounded border border-zinc-300 px-3 py-2"
          placeholder="Название workspace"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-zinc-700">
            Режим работы
          </legend>
          <label
            className={`block rounded-lg border px-3 py-3 cursor-pointer ${
              mode === "bd"
                ? "border-emerald-600 bg-emerald-50"
                : "border-zinc-300 hover:border-zinc-400"
            }`}
          >
            <input
              type="radio"
              name="mode"
              value="bd"
              checked={mode === "bd"}
              onChange={() => setMode("bd")}
              className="sr-only"
            />
            <div className="font-medium text-sm">BD-команда / Биржа</div>
            <div className="text-xs text-zinc-600 mt-1">
              Массовый аутрич по своей базе блогеров без внешнего клиента.
              Воронка/канбан, цепочки автосообщений.
            </div>
          </label>
          <label
            className={`block rounded-lg border px-3 py-3 cursor-pointer ${
              mode === "agency"
                ? "border-emerald-600 bg-emerald-50"
                : "border-zinc-300 hover:border-zinc-400"
            }`}
          >
            <input
              type="radio"
              name="mode"
              value="agency"
              checked={mode === "agency"}
              onChange={() => setMode("agency")}
              className="sr-only"
            />
            <div className="font-medium text-sm">Агентство</div>
            <div className="text-xs text-zinc-600 mt-1">
              Работа на клиента-рекла: клиенты, кампании, медиаплан,
              согласование, отчёт по magic-link.
            </div>
          </label>
        </fieldset>
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

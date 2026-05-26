import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, RefreshCw, Users } from "lucide-react";
import type { components } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";

// Публичный клиентский view по magic-link. Вне _authenticated — без sidebar и
// без session-auth (доступ по токену в URL). Клиент видит шортлист своей
// кампании (без цен агентству) и проставляет «подходит / не подходит / заменить».

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
});

type ClientPlacement = components["schemas"]["ClientPlacement"];
type Decision = "approved" | "rejected" | "replace";

function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(0) + "k";
  return String(n);
}

function SharePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();

  const projectQ = useQuery({
    queryKey: ["share", token] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/share/{token}/project", {
        params: { path: { token } },
      });
      if (error) throw error;
      return data;
    },
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (args: {
      id: string;
      status: Decision;
      comment: string | null;
    }) => {
      if (args.status === "approved") {
        const { error } = await api.POST(
          "/v1/share/{token}/placements/{placementId}/approve",
          {
            params: { path: { token, placementId: args.id } },
            body: { comment: args.comment ?? undefined },
          },
        );
        if (error) throw error;
      } else {
        const { error } = await api.POST(
          "/v1/share/{token}/placements/{placementId}/reject",
          {
            params: { path: { token, placementId: args.id } },
            body: {
              comment: args.comment ?? "",
              replace: args.status === "replace",
            },
          },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share", token] }),
  });

  const onDecide = (id: string, status: Decision) => {
    if (status === "approved") {
      decide.mutate({ id, status, comment: null });
      return;
    }
    const comment = window.prompt(
      status === "replace"
        ? "Что не так? Опишите, какую замену хотите:"
        : "Причина отказа:",
    );
    if (comment === null || comment.trim() === "") return;
    decide.mutate({ id, status, comment: comment.trim() });
  };

  if (projectQ.isLoading) {
    return <Centered>Загрузка…</Centered>;
  }
  if (projectQ.error) {
    return (
      <Centered>
        <div className="text-center">
          <p className="text-lg font-medium text-zinc-900">Ссылка недействительна</p>
          <p className="mt-1 text-sm text-zinc-500">
            Попросите у агентства актуальную ссылку.
          </p>
        </div>
      </Centered>
    );
  }
  const p = projectQ.data!;

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {p.clientName} · {p.agencyName}
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">{p.campaignName}</h1>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        {p.brief && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Бриф</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-700">
              {p.brief}
            </p>
          </section>
        )}

        <section className="rounded-2xl bg-white shadow-sm">
          <div className="border-b border-zinc-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              Подборка блогеров
            </h2>
            <p className="text-xs text-zinc-500">
              Отметьте, какие подходят. Можно изменить решение в любой момент.
            </p>
          </div>
          {p.placements.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">
              Агентство ещё формирует подборку.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {p.placements.map((pl) => (
                <PlacementRow
                  key={pl.id}
                  placement={pl}
                  pending={decide.isPending}
                  onDecide={(status) => onDecide(pl.id, status)}
                />
              ))}
            </ul>
          )}
        </section>
        {decide.error && (
          <p className="text-sm text-red-600">{errorMessage(decide.error)}</p>
        )}
      </main>
    </div>
  );
}

function PlacementRow({
  placement,
  pending,
  onDecide,
}: {
  placement: ClientPlacement;
  pending: boolean;
  onDecide: (status: Decision) => void;
}) {
  const ch = placement.channel;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Users size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-zinc-900">
          {ch?.title ?? "—"}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {ch?.username ? `@${ch.username}` : ""}
          {ch?.memberCount != null && ` · ${formatViews(ch.memberCount)} подписчиков`}
        </div>
      </div>
      <div className="hidden text-right text-xs text-zinc-500 sm:block">
        <div>ПДП {formatViews(placement.forecastViews)}</div>
        <div>
          ERR {placement.forecastErr !== null ? placement.forecastErr + "%" : "—"}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <DecisionBtn
          active={placement.clientStatus === "approved"}
          activeClass="bg-emerald-600 text-white"
          icon={<Check size={14} />}
          disabled={pending}
          onClick={() => onDecide("approved")}
        >
          Подходит
        </DecisionBtn>
        <DecisionBtn
          active={placement.clientStatus === "rejected"}
          activeClass="bg-red-600 text-white"
          icon={<X size={14} />}
          disabled={pending}
          onClick={() => onDecide("rejected")}
        >
          Не подходит
        </DecisionBtn>
        <DecisionBtn
          active={placement.clientStatus === "replace"}
          activeClass="bg-amber-500 text-white"
          icon={<RefreshCw size={14} />}
          disabled={pending}
          onClick={() => onDecide("replace")}
        >
          Заменить
        </DecisionBtn>
      </div>
      {placement.clientStatusComment && (
        <div className="w-full pl-12 text-xs text-zinc-500">
          Ваш комментарий: {placement.clientStatusComment}
        </div>
      )}
    </li>
  );
}

function DecisionBtn({
  active,
  activeClass,
  icon,
  children,
  disabled,
  onClick,
}: {
  active: boolean;
  activeClass: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 " +
        (active
          ? activeClass
          : "border border-zinc-300 text-zinc-600 hover:bg-zinc-50")
      }
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6 text-sm text-zinc-500">
      {children}
    </div>
  );
}

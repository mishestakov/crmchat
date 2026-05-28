import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X, Users } from "lucide-react";
import type { components } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { formatRub, formatViews } from "../lib/format";
import { ChannelPreviewDrawer } from "../components/channel-preview-drawer";
import type { ChannelMessage } from "../components/channel-card";

// Публичный клиентский view по magic-link. Вне _authenticated — без sidebar и
// без session-auth (доступ по токену в URL). Клиент видит шортлист своей
// кампании, проставляет «подходит / не подходит» и финализирует медиаплан
// (после финализации решения заморожены, пока агентство не переоткроет).

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
});

type ClientPlacement = components["schemas"]["ClientPlacement"];

function SharePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const [preview, setPreview] = useState<{
    placementId: string;
    title: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);

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
  const finalize = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST("/v1/share/{token}/finalize", {
        params: { path: { token } },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share", token] }),
  });

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
  const finalized = !!p.finalizedAt;
  // Финализировать можно только когда по каждому размещению есть решение.
  const allDecided =
    p.placements.length > 0 &&
    p.placements.every((pl) => pl.clientStatus !== "pending");

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {p.clientName} · {p.agencyName}
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">{p.campaignName}</h1>
        </div>
      </header>

      <main className="space-y-5 px-6 py-6">
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
              {finalized
                ? "Медиаплан финализирован — решения зафиксированы."
                : "Отметьте, какие подходят. Можно менять решения, пока не финализируете медиаплан."}
            </p>
          </div>
          {p.placements.length === 0 ? (
            <p className="px-5 py-6 text-sm text-zinc-500">
              Агентство ещё формирует подборку.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Канал</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Подписчики
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Охват</th>
                    <th className="px-4 py-2 text-right font-medium">ERR</th>
                    <th className="px-4 py-2 text-right font-medium">Цена</th>
                    <th className="px-4 py-2 font-medium">Решение</th>
                  </tr>
                </thead>
                <tbody>
                  {p.placements.map((pl) => (
                    <PlacementRow
                      key={pl.id}
                      placement={pl}
                      token={token}
                      finalized={finalized}
                      onPreview={() =>
                        setPreview({
                          placementId: pl.id,
                          title: pl.channel?.title ?? "Канал",
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {p.placements.length > 0 &&
            (finalized ? (
              <div className="border-t border-zinc-100 bg-emerald-50 px-5 py-3 text-sm text-emerald-800">
                ✓ Медиаплан финализирован.
              </div>
            ) : !allDecided ? (
              <div className="border-t border-zinc-100 px-5 py-4 text-center text-sm text-zinc-500">
                Отметьте все размещения (подходит / не подходит), чтобы
                финализировать медиаплан.
              </div>
            ) : (
              <div className="border-t border-zinc-100 px-5 py-4">
                {confirming ? (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm text-zinc-700">
                      Финализировать медиаплан? После этого решения нельзя будет
                      менять.
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => finalize.mutate()}
                        disabled={finalize.isPending}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {finalize.isPending ? "Финализируем…" : "Да, финализировать"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(false)}
                        disabled={finalize.isPending}
                        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    Финализировать медиаплан
                  </button>
                )}
                {finalize.error && (
                  <p className="mt-2 text-center text-xs text-red-600">
                    {errorMessage(finalize.error)}
                  </p>
                )}
              </div>
            ))}
        </section>
      </main>

      {preview && (
        <ChannelPreviewDrawer
          title={preview.title}
          queryKey={["share-preview", token, preview.placementId]}
          queryFn={async () => {
            const { data, error } = await api.GET(
              "/v1/share/{token}/placements/{placementId}/preview",
              { params: { path: { token, placementId: preview.placementId } } },
            );
            if (error) throw error;
            return data!.messages as ChannelMessage[];
          }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function PlacementRow({
  placement,
  token,
  finalized,
  onPreview,
}: {
  placement: ClientPlacement;
  token: string;
  finalized: boolean;
  onPreview: () => void;
}) {
  const qc = useQueryClient();
  const ch = placement.channel;
  const cs = placement.clientStatus;
  // Комментарий — локальный черновик, но ресинкаем с сервером: если данные
  // перезагрузились (refetch, правка из другой вкладки), подтягиваем свежее,
  // иначе блёр затёр бы новый серверный текст устаревшим (key=pl.id стабилен,
  // компонент не пересоздаётся). serverComment !== prevServer — derived state.
  const serverComment = placement.clientStatusComment ?? "";
  const [comment, setComment] = useState(serverComment);
  const [prevServer, setPrevServer] = useState(serverComment);
  if (serverComment !== prevServer) {
    setPrevServer(serverComment);
    setComment(serverComment);
  }
  const save = useMutation({
    mutationFn: async (status: "pending" | "approved" | "rejected") => {
      const { error } = await api.POST(
        "/v1/share/{token}/placements/{placementId}/decision",
        {
          params: { path: { token, placementId: placement.id } },
          body: { status, comment: comment.trim() || null },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["share", token] }),
  });
  // Кнопка — тоггл текущего решения: клик по активному возвращает в pending
  // («передумал»), клик по другому — переключает. Комментарий шлётся с любым.
  const setStatus = (s: "approved" | "rejected") =>
    save.mutate(cs === s ? "pending" : s);
  const commentChanged = comment.trim() !== serverComment.trim();
  const locked = finalized || save.isPending;
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
            <Users size={15} />
          </span>
          <div className="min-w-0">
            <button
              type="button"
              disabled={!ch}
              onClick={onPreview}
              title={ch ? "Посмотреть посты канала" : undefined}
              className="block max-w-full truncate text-left text-sm font-medium text-zinc-900 hover:text-emerald-700 disabled:hover:text-zinc-900"
            >
              {ch?.title ?? "—"}
            </button>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              {ch?.username && <span className="truncate">@{ch.username}</span>}
              {ch?.username && (
                <a
                  href={`https://t.me/${ch.username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-[#229ED9] hover:underline"
                >
                  в Telegram ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatViews(ch?.memberCount ?? null)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatViews(ch?.avgReach ?? null)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {ch?.err != null ? ch.err + "%" : "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatRub(placement.price)}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1">
            <DecisionPill
              active={cs === "approved"}
              activeClass="bg-emerald-600 text-white ring-emerald-600"
              icon={<Check size={13} />}
              disabled={locked}
              onClick={() => setStatus("approved")}
            >
              Подходит
            </DecisionPill>
            <DecisionPill
              active={cs === "rejected"}
              activeClass="bg-red-600 text-white ring-red-600"
              icon={<X size={13} />}
              disabled={locked}
              onClick={() => setStatus("rejected")}
            >
              Не подходит
            </DecisionPill>
          </div>
          <textarea
            rows={1}
            value={comment}
            readOnly={finalized}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => {
              if (commentChanged && !locked) save.mutate(cs);
            }}
            placeholder="Комментарий (необязательно)"
            className="w-full max-w-[260px] resize-none rounded-md border border-zinc-300 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none read-only:bg-zinc-50 read-only:text-zinc-500"
          />
          {save.error && (
            <p className="text-xs text-red-600">{errorMessage(save.error)}</p>
          )}
        </div>
      </td>
    </tr>
  );
}

// Компактная кнопка-тоггл решения. onMouseDown preventDefault — чтобы клик по
// кнопке не снимал фокус с textarea комментария (иначе blur-save дёрнется лишний
// раз гонкой с кликом).
function DecisionPill({
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ring-1 transition-colors disabled:opacity-50 " +
        (active ? activeClass : "text-zinc-600 ring-zinc-300 hover:bg-zinc-50")
      }
    >
      {icon}
      {children}
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

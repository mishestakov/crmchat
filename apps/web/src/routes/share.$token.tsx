import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X, Users, Link as LinkIcon, Eye } from "lucide-react";
import type { components } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { copyText } from "../lib/clipboard";
import { formatRub, formatViews, cpv } from "../lib/format";
import {
  type ShareStep,
  SHARE_STEPS,
  shareDeepLink,
} from "../lib/share-steps";
import { ChannelPreviewDrawer } from "../components/channel-preview-drawer";
import { PLATFORMS, PlatformBadge } from "../lib/platforms";
import type { ChannelMessage } from "../components/channel-card";

// Публичный клиентский view по magic-link. Вне _authenticated — без sidebar и
// без session-auth (доступ по токену в URL). Клиент видит шортлист своей
// кампании, проставляет «подходит / не подходит» и финализирует медиаплан
// (после финализации решения заморожены, пока агентство не переоткроет).

// Активный таб клиента в URL: агентство шлёт ссылку с этапом (на каком этапе
// менеджер был при копировании), клиент шерит/рефрешит — вид сохраняется. Нет
// параметра → дефолт на наибольшую доступную стадию (см. SharePage).
type ShareSearch = { step?: ShareStep };

export const Route = createFileRoute("/share/$token")({
  validateSearch: (s: Record<string, unknown>): ShareSearch => ({
    step: SHARE_STEPS.includes(s.step as ShareStep)
      ? (s.step as ShareStep)
      : undefined,
  }),
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
  // Активный таб — в URL (?step). Клик пишет туда (replace), чтобы рефреш/шеринг
  // сохраняли вид. Нет параметра → дефолт на наибольшую доступную стадию (ниже).
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setStep = (key: ShareStep) =>
    void navigate({ search: { step: key }, replace: true });
  const [copied, setCopied] = useState(false);

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
  // Шаг 3 — отчёт: вышедшие посты + метрики. Появляется в конце кампании.
  const reportQ = useQuery({
    queryKey: ["share-report", token] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/share/{token}/report", {
        params: { path: { token } },
      });
      if (error) throw error;
      return data!.items;
    },
    retry: false,
  });

  // Ждём и доп-запрос отчёта: дефолт-таб (highestAvailable) считается из report —
  // иначе на голой ссылке вспышка «Блогеры» → прыжок на готовый этап.
  // retry:false → при ошибке isLoading спадает, не зависаем.
  if (projectQ.isLoading || reportQ.isLoading) {
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

  // Две стадии клиента: блогеры → отчёт. done определяет, где клиент сейчас
  // (current = первая незавершённая). Отчёт «есть» по наличию данных.
  const report = reportQ.data ?? [];
  // done монотонно: наличие отчёта означает, что предыдущие стадии пройдены.
  const reportReady = report.length > 0;
  // Бейдж «ждут вашего решения»: блогеры без решения (до финализации).
  const bloggersPending = finalized
    ? 0
    : p.placements.filter((pl) => pl.clientStatus === "pending").length;
  const stages: {
    key: ShareStep;
    label: string;
    done: boolean;
    badge: number;
  }[] = [
    {
      key: "bloggers",
      label: "Блогеры",
      done: finalized || reportReady,
      badge: bloggersPending,
    },
    { key: "report", label: "Отчёт", done: reportReady, badge: 0 },
  ];
  const currentIdx = stages.findIndex((s) => !s.done);
  // Дефолт — наибольшая ДОСТУПНАЯ стадия (где есть данные): клиент сразу видит
  // самое свежее, что выдало агентство, и не попадает на пустой таб. Явный ?step
  // (ссылка от агентства / рефреш / шеринг) переопределяет.
  const highestAvailable: ShareStep = reportReady ? "report" : "bloggers";
  const active: ShareStep = step ?? highestAvailable;
  // Копируем ДЕТЕРМИНИРОВАННЫЙ deep-link (с явным ?step), а не текущий href —
  // иначе на дефолте (без параметра) ссылка «поплывёт» при смене стадий.
  const copyLink = () => {
    const url = shareDeepLink(
      window.location.origin + window.location.pathname,
      active,
    );
    void copyText(url).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  // «Набрано» = сумма клиентских цен по одобренным размещениям (попадаем ли в бюджет).
  const approved = p.placements.filter((pl) => pl.clientStatus === "approved");
  const approvedSum = approved.reduce((s, pl) => s + (pl.price ?? 0), 0);

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="px-6 pt-4">
          <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {p.clientName} · {p.agencyName}
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">{p.campaignName}</h1>
        </div>
        <StageTabs
          stages={stages}
          currentIdx={currentIdx}
          active={active}
          onSelect={setStep}
          onCopyLink={copyLink}
          copied={copied}
        />
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

        {active === "bloggers" && (
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
          {p.placements.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-zinc-100 px-5 py-2.5 text-sm">
              {p.budget != null && (
                <span className="text-zinc-600">
                  Бюджет{" "}
                  <b className="tabular-nums text-zinc-900">
                    {formatRub(p.budget)}
                  </b>
                </span>
              )}
              <span className="text-zinc-600">
                Одобрено{" "}
                <b className="tabular-nums text-zinc-900">
                  {formatRub(approvedSum)}
                </b>
                <span className="text-zinc-400"> · {approved.length} размещ.</span>
              </span>
              {p.budget != null && approvedSum > p.budget && (
                <span className="font-medium text-red-600">
                  превышение бюджета
                </span>
              )}
            </div>
          )}
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
                    <th className="px-4 py-2 text-right font-medium">
                      Прогноз охвата
                    </th>
                    <th className="px-4 py-2 text-right font-medium">ERR</th>
                    <th className="px-4 py-2 text-right font-medium">Цена</th>
                    <th className="px-4 py-2 text-right font-medium">CPV</th>
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
        )}

        {active === "report" &&
          (reportReady ? (
            <ReportSection items={report} budget={p.budget} />
          ) : (
            <EmptyTab text="Отчёт появится после публикаций кампании." />
          ))}
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
  // Прогноз охвата = снапшот forecastViews (что обещали), иначе живой охват
  // канала. Один знаменатель и для колонки, и для CPV — чтобы цифры сходились.
  const reach = placement.forecastViews ?? ch?.avgReach ?? null;
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
              {ch && <PlatformBadge platform={ch.platform} />}
              {ch?.username && (
                <a
                  href={PLATFORMS[ch.platform].url(ch.username)}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  @{ch.username}
                </a>
              )}
            </div>
            {/* Явная кнопка предпросмотра — киллер-фича «посмотреть контент
                канала» не должна прятаться за кликом по названию. */}
            <button
              type="button"
              disabled={!ch}
              onClick={onPreview}
              className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
            >
              <Eye size={13} />
              Предпросмотр постов
            </button>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatViews(ch?.memberCount ?? null)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatViews(reach)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {ch?.err != null ? ch.err + "%" : "—"}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-zinc-700">
        {formatRub(placement.price)}
      </td>
      <td className="px-4 py-3 text-right font-medium tabular-nums text-zinc-900">
        {cpv(placement.price, reach)}
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

// Табы двух клиентских стадий (блогеры · отчёт). Клик переключает
// активную секцию. Кружок слева: ✓ пройдено, номер на текущей/будущей; цвет —
// done/current/upcoming (currentIdx === -1 → всё пройдено).
function StageTabs({
  stages,
  currentIdx,
  active,
  onSelect,
  onCopyLink,
  copied,
}: {
  stages: { key: ShareStep; label: string; done: boolean; badge: number }[];
  currentIdx: number;
  active: ShareStep;
  onSelect: (key: ShareStep) => void;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const stateOf = (i: number) =>
    currentIdx === -1 || i < currentIdx
      ? "done"
      : i === currentIdx
        ? "current"
        : "upcoming";
  return (
    <div className="flex items-center gap-1 px-6">
      {stages.map((s, i) => {
        const st = stateOf(i);
        const isActive = active === s.key;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors " +
              (isActive
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-zinc-500 hover:text-zinc-800")
            }
          >
            <span
              className={
                "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold " +
                (st === "done"
                  ? "bg-emerald-100 text-emerald-700"
                  : st === "current"
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-100 text-zinc-400")
              }
            >
              {st === "done" ? "✓" : i + 1}
            </span>
            {s.label}
            {s.badge > 0 && (
              <span
                title="Ждут вашего решения"
                className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold leading-none text-white"
              >
                {s.badge}
              </span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCopyLink}
        title="Скопировать ссылку на этот вид (можно переслать)"
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <LinkIcon size={13} />
        {copied ? "Скопировано" : "Копировать ссылку"}
      </button>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-white p-10 text-center text-sm text-zinc-400 shadow-sm">
      {text}
    </div>
  );
}

type ClientReportItem = components["schemas"]["ClientReportItem"];

// Шаг 3 — отчёт: список вышедших постов с метриками + итоговая строка
// (суммарный охват, потрачено из бюджета, средний CPV).
function ReportSection({
  items,
  budget,
}: {
  items: ClientReportItem[];
  budget: number | null;
}) {
  const totalViews = items.reduce((s, it) => s + (it.views ?? 0), 0);
  const totalBudget = items.reduce((s, it) => s + (it.price ?? 0), 0);
  // Средний CPV — только по постам со снятыми метриками: иначе бюджет ещё-не-
  // измеренных попадает в числитель при нуле в знаменателе и CPV завышается.
  const measured = items.filter((it) => it.views != null);
  const measuredViews = measured.reduce((s, it) => s + (it.views ?? 0), 0);
  const measuredBudget = measured.reduce((s, it) => s + (it.price ?? 0), 0);
  return (
    <section className="rounded-2xl bg-white shadow-sm">
      <div className="border-b border-zinc-100 px-5 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">Отчёт</h2>
        <p className="text-xs text-zinc-500">
          Вышедшие публикации и их результаты.
        </p>
      </div>
      <div className="divide-y divide-zinc-100">
        {items.map((it) => (
          <ReportRow key={it.id} item={it} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-100 bg-zinc-50 px-5 py-3 text-sm">
        <span className="font-medium text-zinc-700">Итого</span>
        <div className="flex flex-wrap gap-x-6 gap-y-1 tabular-nums">
          <span className="text-zinc-600">
            Охват <b className="text-zinc-900">{formatViews(totalViews)}</b>
          </span>
          <span className="text-zinc-600">
            Ср. CPV{" "}
            <b className="text-zinc-900">
              {cpv(measuredBudget, measuredViews)}
            </b>
          </span>
          <span className="text-zinc-600">
            Потрачено <b className="text-zinc-900">{formatRub(totalBudget)}</b>
            {budget != null && (
              <span className="text-zinc-400"> из {formatRub(budget)}</span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

function ReportRow({ item }: { item: ClientReportItem }) {
  const cover = item.preview?.cover ?? null;
  const text = item.preview?.text ?? null;
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="h-16 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded-lg bg-zinc-100" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-zinc-900">
            {item.channel && (
              <PlatformBadge platform={item.channel.platform} />
            )}
            <span className="truncate">{item.channel?.title ?? "—"}</span>
          </span>
          {item.publishedAt && (
            <span className="shrink-0 text-xs text-zinc-400">
              {new Date(item.publishedAt).toLocaleDateString("ru-RU")}
            </span>
          )}
        </div>
        {text && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{text}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-zinc-600">
          <Metric label="просмотры" value={item.views} />
          <Metric label="лайки" value={item.likes} />
          <Metric label="комменты" value={item.comments} />
          <Metric label="репосты" value={item.shares} />
          {item.price != null && (
            <span className="text-zinc-500">
              цена <b className="text-zinc-800">{formatRub(item.price)}</b>
            </span>
          )}
          {item.price != null && item.views != null && item.views > 0 && (
            <span className="text-zinc-500">
              CPV{" "}
              <b className="text-zinc-900">{cpv(item.price, item.views)}</b>
            </span>
          )}
          {item.postUrl && (
            <a
              href={item.postUrl}
              target="_blank"
              rel="noreferrer"
              className="text-emerald-600 hover:underline"
            >
              открыть пост ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span className="text-zinc-500">
      {label} <b className="text-zinc-900">{formatViews(value)}</b>
    </span>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6 text-sm text-zinc-500">
      {children}
    </div>
  );
}

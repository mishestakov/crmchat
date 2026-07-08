import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Send,
  Users,
  Check,
  CheckCheck,
  MessageCircle,
  MessageCircleReply,
  Pause,
  Play,
  CheckCircle2,
  RefreshCw,
  Eye,
  Repeat2,
  Heart,
  Link2,
} from "lucide-react";
import { Modal } from "../../../../../components/modal";
import { AddChannelsModal } from "../../../../../components/add-channels-modal";
import {
  OpenerEditor,
  type Opener,
} from "../../../../../components/opener-editor";
import { api } from "../../../../../lib/api";
import { copyText } from "../../../../../lib/clipboard";
import { errorMessage } from "../../../../../lib/errors";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import {
  useOutreachAccounts,
  useProjectShares,
} from "../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../lib/query-keys";
import { PlatformBadge } from "../../../../../lib/platforms";
import { ChannelBadges } from "../../../../../components/channel-badges";
import { ProgressBar } from "../../../../../components/progress-bar";
import {
  type ShareStep,
  shareDeepLink,
} from "../../../../../lib/share-steps";
import { LeadChatDrawer } from "../../../../../components/lead-chat-drawer";
import {
  formatPastRelative,
  formatDateTime,
} from "../../../../../lib/date-utils";
import {
  type PhaseKey,
  type Placement,
  type Campaign,
  PHASE_CLIENT_STEP,
  placementPricing,
  formatRub,
  formatViews,
  cpv,
} from "./-shared";
import {
  Chip,
  PhaseStepper,
  clientView,
  contractState,
  contractView,
  creativeView,
  deriveProduction,
  PROD_OWNER,
  PROD_OWNER_ORDER,
  type ProdOwner,
} from "./-ui";
import { PlacementPane, ProductionPane } from "./-placement-drawer";
import { ChannelDrawer } from "../../../../../components/channel-drawer";
import {
  ChannelPreviewDrawer,
} from "../../../../../components/channel-preview-drawer";
import type { ChannelMessage } from "../../../../../components/channel-card";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/campaigns/$campaignId",
)({
  component: CampaignPage,
});

function CampaignPage() {
  const { wsId, campaignId } = Route.useParams();
  const qc = useQueryClient();

  const campaignQ = useQuery({
    queryKey: ["campaign", wsId, campaignId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        { params: { path: { wsId, projectId: campaignId } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const tracksQ = useQuery({
    queryKey: ["tracks", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/tracks", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });

  // Фаза — local state, инициализируется из campaign.phase. Свободная
  // навигация: при переключении сохраняем phase в БД (бейдж в списке +
  // дефолтный экран при следующем заходе), но экраны доступны в любом порядке.
  const [phaseOverride, setPhaseOverride] = useState<PhaseKey | null>(null);
  const phaseMut = useMutation({
    mutationFn: async (phase: PhaseKey) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        { params: { path: { wsId, projectId: campaignId } }, body: { phase } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaign", wsId, campaignId] }),
  });

  const campaign = campaignQ.data;
  if (!campaign) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        {campaignQ.error ? errorMessage(campaignQ.error) : "Загрузка…"}
      </div>
    );
  }

  const phase = phaseOverride ?? (campaign.phase as PhaseKey);
  const pickPhase = (p: PhaseKey) => {
    setPhaseOverride(p);
    if (p !== campaign.phase) phaseMut.mutate(p);
  };
  const clientName =
    tracksQ.data?.find((t) => t.id === campaign.trackId)?.name ?? "—";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                {clientName}
              </div>
              <h1 className="truncate text-lg font-semibold">{campaign.name}</h1>
            </div>
            <StatusControls wsId={wsId} campaign={campaign} />
            <div className="ml-auto text-sm">
              <Meta label="Бюджет" value={formatRub(campaign.budgetAmount)} />
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-4 pt-2">
          <PhaseStepper current={phase} onPick={pickPhase} />
        </div>
      </div>

      {/* Лонглист — инбокс на всю ширину и высоту (вне max-w-6xl, от края до
          края). Остальные фазы — в центрированной прокручиваемой колонке. */}
      {phase === "longlist" || phase === "production" ? (
        // Инбокс-фазы — на всю ширину/высоту (от края до края). ProductionPhase
        // в matrix-режиме сам центрирует таблицу в max-w-6xl.
        <div className="min-h-0 flex-1">
          {phase === "longlist" && (
            <LonglistPhase wsId={wsId} campaign={campaign} />
          )}
          {phase === "production" && (
            <ProductionPhase wsId={wsId} campaign={campaign} />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-5">
            {phase === "briefing" && (
              <BriefPhase wsId={wsId} campaign={campaign} />
            )}
            {phase === "review" && <ReviewPhase wsId={wsId} campaign={campaign} />}
            {phase === "shortlist" && (
              <ShortlistPhase wsId={wsId} campaign={campaign} />
            )}
            {phase === "wrapup" && <WrapupPhase wsId={wsId} campaign={campaign} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="hidden text-right sm:block">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="font-medium text-zinc-700">{value}</div>
    </div>
  );
}

const STATUS_VIEW: Record<string, { label: string; tone: "zinc" | "emerald" | "amber" }> = {
  draft: { label: "Черновик", tone: "zinc" },
  active: { label: "Идёт", tone: "emerald" },
  paused: { label: "Пауза", tone: "amber" },
  done: { label: "Завершена", tone: "zinc" },
};

// Управление статусом кампании: пауза/возобновление/завершение рассылки.
// Запуск — кнопкой в фазе Лонглист (там же проверки messages/placements).
function StatusControls({ wsId, campaign }: { wsId: string; campaign: Campaign }) {
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: async (verb: "pause" | "resume" | "complete") => {
      const { error } = await api.POST(
        `/v1/workspaces/{wsId}/projects/{projectId}/${verb}` as
          "/v1/workspaces/{wsId}/projects/{projectId}/pause",
        { params: { path: { wsId, projectId: campaign.id } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaign", wsId, campaign.id] }),
  });
  const v = STATUS_VIEW[campaign.status] ?? STATUS_VIEW.draft!;

  return (
    <div className="flex items-center gap-2">
      <Chip tone={v.tone}>{v.label}</Chip>
      {campaign.status === "active" && (
        <CtlBtn icon={<Pause size={14} />} onClick={() => mut.mutate("pause")}>
          Пауза
        </CtlBtn>
      )}
      {campaign.status === "paused" && (
        <CtlBtn icon={<Play size={14} />} onClick={() => mut.mutate("resume")}>
          Возобновить
        </CtlBtn>
      )}
      {(campaign.status === "active" || campaign.status === "paused") && (
        <CtlBtn
          icon={<CheckCircle2 size={14} />}
          onClick={() => {
            if (window.confirm("Завершить кампанию? Незавершённые отправки отменятся.")) {
              mut.mutate("complete");
            }
          }}
        >
          Завершить
        </CtlBtn>
      )}
    </div>
  );
}

function CtlBtn({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
    >
      {icon}
      {children}
    </button>
  );
}

// ── Фаза 1: Бриф ──────────────────────────────────────────────────────────
// Парс процента из ru-ввода: запятая → точка, пусто/мусор → дефолт. Иначе
// Number("20,5")=NaN → JSON шлёт null → Zod z.number() (не nullable) 400-ит
// весь бриф (не только это поле).
function parsePct(s: string, dflt: number): number {
  if (!s.trim()) return dflt;
  const n = Number(s.trim().replace(",", "."));
  return Number.isFinite(n) ? n : dflt;
}

function BriefPhase({
  wsId,
  campaign,
}: {
  wsId: string;
  campaign: Campaign;
}) {
  const qc = useQueryClient();
  // Даты храним как YYYY-MM-DD (формат <input type=date>); в API уходит ISO.
  const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
  const snapshot = () => ({
    brief: campaign.brief ?? "",
    budgetAmount: campaign.budgetAmount?.toString() ?? "",
    periodStart: toDateInput(campaign.periodStart),
    periodEnd: toDateInput(campaign.periodEnd),
    tov: campaign.tov ?? "",
    constraints: campaign.constraints ?? "",
    advertiserData: campaign.advertiserData ?? "",
    // Ценовые настройки кампании (срез 3).
    akPercent: campaign.akPercent.toString(),
    vatEnabled: campaign.vatEnabled,
    vatRate: campaign.vatRate.toString(),
    ordEnabled: campaign.ordEnabled,
    splitEnabled: campaign.splitEnabled,
  });
  const [draft, setDraft] = useState(snapshot);
  const server = snapshot();
  const dirty = JSON.stringify(draft) !== JSON.stringify(server);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId: campaign.id } },
          body: {
            brief: draft.brief || null,
            budgetAmount: draft.budgetAmount.trim()
              ? Number(draft.budgetAmount)
              : null,
            periodStart: draft.periodStart
              ? new Date(draft.periodStart).toISOString()
              : null,
            periodEnd: draft.periodEnd
              ? new Date(draft.periodEnd).toISOString()
              : null,
            tov: draft.tov || null,
            constraints: draft.constraints || null,
            advertiserData: draft.advertiserData || null,
            akPercent: parsePct(draft.akPercent, 0),
            vatEnabled: draft.vatEnabled,
            vatRate: parsePct(draft.vatRate, 22),
            ordEnabled: draft.ordEnabled,
            splitEnabled: draft.splitEnabled,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", wsId, campaign.id] });
      // Пустой ввод АК/ставки ушёл как 0/22 (колонки NOT NULL), а draft держит
      // "" — иначе dirty остался бы навсегда true и кнопка «Сохранить» не
      // спряталась бы после успешного сейва (§6). Приводим черновик к тому же
      // числу, что и сервер.
      setDraft((d) => ({
        ...d,
        akPercent: String(parsePct(d.akPercent, 0)),
        vatRate: String(parsePct(d.vatRate, 22)),
      }));
    },
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900">Бриф кампании</h2>
        <BriefField label="Суть кампании">
          <textarea
            rows={4}
            value={draft.brief}
            onChange={(e) => setDraft((d) => ({ ...d, brief: e.target.value }))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </BriefField>
        <div className="grid gap-4 sm:grid-cols-3">
          <BriefField label="Бюджет, ₽">
            <input
              inputMode="numeric"
              value={draft.budgetAmount}
              onChange={(e) =>
                setDraft((d) => ({ ...d, budgetAmount: e.target.value }))
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </BriefField>
          <BriefField label="Старт кампании">
            <input
              type="date"
              value={draft.periodStart}
              onChange={(e) =>
                setDraft((d) => ({ ...d, periodStart: e.target.value }))
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </BriefField>
          <BriefField label="Финиш кампании">
            <input
              type="date"
              value={draft.periodEnd}
              min={draft.periodStart || undefined}
              onChange={(e) =>
                setDraft((d) => ({ ...d, periodEnd: e.target.value }))
              }
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </BriefField>
        </div>
        <BriefField label="Tone of voice">
          <textarea
            rows={3}
            value={draft.tov}
            onChange={(e) => setDraft((d) => ({ ...d, tov: e.target.value }))}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </BriefField>
        <BriefField label="Ограничения">
          <textarea
            rows={2}
            value={draft.constraints}
            onChange={(e) =>
              setDraft((d) => ({ ...d, constraints: e.target.value }))
            }
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </BriefField>
        <BriefField label="Рекламодатель (ИНН + название)">
          <input
            value={draft.advertiserData}
            onChange={(e) =>
              setDraft((d) => ({ ...d, advertiserData: e.target.value }))
            }
            placeholder="ИНН 7700000000, ООО «Рекламодатель»"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-zinc-400">
            Подставится в ЕРИД-шаг всех размещений кампании.
          </p>
        </BriefField>

        <div className="border-t border-zinc-100 pt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Ценообразование
          </div>
          <p className="mb-3 text-xs text-zinc-400">
            Множители цепочки «стоимость блогера → цена клиенту». Применяются ко
            всем сделкам кампании.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              Агентская комиссия
              <input
                inputMode="numeric"
                value={draft.akPercent}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, akPercent: e.target.value }))
                }
                className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none"
              />
              %
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={draft.vatEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, vatEnabled: e.target.checked }))
                }
              />
              НДС клиенту
              <input
                inputMode="numeric"
                value={draft.vatRate}
                disabled={!draft.vatEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, vatRate: e.target.value }))
                }
                className="w-14 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none disabled:bg-zinc-100 disabled:text-zinc-400"
              />
              %
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={draft.ordEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, ordEnabled: e.target.checked }))
                }
              />
              +3% ОРД
            </label>
            <label
              className="flex items-center gap-2 text-sm text-zinc-700"
              title="Делить сумму блогера на создание контента (без ОРД) и размещение (+3%). Доля создания задаётся у каждого блогера в сделке."
            >
              <input
                type="checkbox"
                checked={draft.splitEnabled}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, splitEnabled: e.target.checked }))
                }
              />
              Сплит создание/размещение
            </label>
          </div>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
        )}
        {save.error && (
          <p className="text-sm text-red-600">{errorMessage(save.error)}</p>
        )}
      </div>
    </div>
  );
}

function BriefField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </div>
      {children}
    </div>
  );
}

// ── Фаза 2: Лонглист + аутрич — инбокс: список блогеров слева, чат с админом
//    справа, данные подбора компактной строкой над чатом ─────────────────────
function LonglistPhase({
  wsId,
  campaign,
}: {
  wsId: string;
  campaign: Campaign;
}) {
  const qc = useQueryClient();
  const projectId = campaign.id;
  const [addOpen, setAddOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [showDeclined, setShowDeclined] = useState(false);

  // stage=longlist — только те, кого ещё опрашиваем (выбывшие «в шортлист» не
  // показываются здесь, они на фазе согласования).
  const placementsQ = useQuery({
    queryKey: ["placements", wsId, projectId, "longlist"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId }, query: { stage: "longlist" } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // Live: worker отправляет сообщения / приходят ответы — статусы и счётчики
  // обновляются без F5. Активно для active/paused (в draft рассылка не идёт).
  const live = campaign.status === "active" || campaign.status === "paused";
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/projects/${projectId}/stream` : null,
    "changed",
    () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
    },
  );
  // Входящий ответ обновляет contact (unread/lastMessageAt) и repliedAt лида, но
  // project-stream «changed» летит только при отмене pending. Подписываемся ещё
  // на contact-stream — иначе бейдж unread / статус «ответил» в левом списке не
  // обновляются live (только после F5). Рефетч placements лёгкий.
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/contact-stream` : null,
    "contact",
    () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
    },
  );

  // Отказ (available=false → chainStatus 'declined') прячем из списка и не
  // считаем в прогрессе/гейте — совпадает с бэком (этап 16.10).
  const all = placementsQ.data ?? [];
  const declinedCount = all.filter((p) => p.chainStatus === "declined").length;
  const active = all.filter((p) => p.chainStatus !== "declined");
  const visible = showDeclined ? all : active;
  const total = active.length;
  const ready = active.filter((p) => p.contactReady).length;
  const unready = total - ready;
  // Готовы, но способ связи ручной (бот/группа/личка) — авто-опенер не уйдёт.
  const manualReady = active.filter(
    (p) =>
      p.contactReady &&
      !(!!p.adminContactId && !p.adminIsBot && p.hasRecipient),
  ).length;
  const replied = active.filter((p) => p.chainStatus === "replied").length;
  const pct = total > 0 ? Math.round((ready / total) * 100) : 0;
  const isDraft = campaign.status === "draft";

  // Управляемый выбор строки: чипы «братьев» в drawer'е (Option A) переключают
  // активное размещение того же админа, не уходя из панели.
  const [selId, setSelId] = useState<string | null>(null);

  // Размещения одного админа в кампании: один memo кормит и хинт «ещё N у
  // админа» в строке (этап 16.8), и чипы-переключатель в панели (Option A).
  // Группируем видимый список по adminContactId — count = длина массива.
  const adminGroups = useMemo(() => {
    const data = placementsQ.data ?? [];
    const src = showDeclined
      ? data
      : data.filter((p) => p.chainStatus !== "declined");
    const m = new Map<string, Placement[]>();
    for (const p of src) {
      if (p.adminContactId) {
        const g = m.get(p.adminContactId);
        if (g) g.push(p);
        else m.set(p.adminContactId, [p]);
      }
    }
    return m;
  }, [placementsQ.data, showDeclined]);

  return (
    <div className="flex h-full flex-col">
      {/* Тулбар: прогресс готовности контактов + добавить/запустить (этап 16.8). */}
      <div className="shrink-0 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <ProgressBar
              pct={pct}
              className="w-32"
              fillClass={
                unready === 0 && total > 0 ? "bg-emerald-500" : "bg-amber-400"
              }
            />
            <span className="text-xs text-zinc-600">
              Контакты {ready}/{total}
              {unready > 0 && (
                <span className="font-medium text-amber-600">
                  {" · "}
                  {unready} без контакта
                </span>
              )}
              {manualReady > 0 && (
                <span className="text-zinc-400">
                  {" · "}
                  {manualReady} вручную
                </span>
              )}
              {replied > 0 && ` · ${replied} ответ.`}
            </span>
          </div>
          {declinedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDeclined((v) => !v)}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              {showDeclined ? "скрыть отказ" : `показать отказ (${declinedCount})`}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <Plus size={15} /> Добавить блогеров
            </button>
            {isDraft && (
              <button
                type="button"
                onClick={() => setLaunchOpen(true)}
                disabled={total === 0 || unready > 0}
                title={
                  unready > 0
                    ? `${unready} каналов без контакта — найдите контакт или уберите из лонглиста`
                    : total === 0
                      ? "Добавьте блогеров"
                      : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                <Send size={15} /> Запустить аутрич
                {total > 0 ? ` (${total})` : ""}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <InboxShell
          items={visible}
          getId={(p) => p.id}
          selectedId={selId}
          onSelectId={setSelId}
          emptyHint="Лонглист пуст. Нажмите «Добавить блогеров», чтобы импортировать каналы — они сразу просканируются."
          renderRow={(p, selected, onSelect) => (
            <BloggerRow
              p={p}
              selected={selected}
              onSelect={onSelect}
              siblingCount={
                p.adminContactId
                  ? (adminGroups.get(p.adminContactId)?.length ?? 1) - 1
                  : 0
              }
            />
          )}
          renderPane={(p) => (
            <PlacementPane
              wsId={wsId}
              projectId={projectId}
              placement={p}
              pricing={{
                akPercent: campaign.akPercent,
                vat: campaign.vatEnabled,
                vatRate: campaign.vatRate,
                ord3: campaign.ordEnabled,
                split: campaign.splitEnabled,
              }}
              siblings={
                p.adminContactId
                  ? (adminGroups.get(p.adminContactId) ?? []).filter(
                      // Чипы — только живые размещения: отказанные (available=false)
                      // исключены из прогресса/гейтов везде, не делаем их
                      // переключаемыми и не считаем в «Диалог по N».
                      (s) => s.chainStatus !== "declined",
                    )
                  : []
              }
              onSelectPlacement={setSelId}
              onRemoved={() => {}}
            />
          )}
        />
      </div>

      {addOpen && (
        <AddChannelsModal
          wsId={wsId}
          projectId={projectId}
          onClose={() => setAddOpen(false)}
          title="Добавить блогеров в лонглист"
          unit="блогеров"
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
            qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] });
          }}
        />
      )}
      {launchOpen && (
        <LaunchModal
          wsId={wsId}
          campaign={campaign}
          onClose={() => setLaunchOpen(false)}
        />
      )}
    </div>
  );
}

// Инбокс: левый список + правая панель выбранного. Переиспользуется фазами
// (Лонглист сейчас, Запуск — следующим проходом): наполнение строки/панели
// задаёт фаза через renderRow/renderPane, каркас общий — выбор, «держим
// валидный выбор», круглый «+», пустое состояние, высота от края до края.
function InboxShell<T>({
  items,
  getId,
  renderRow,
  renderPane,
  emptyHint,
  onAdd,
  addTitle,
  headerRight,
  selectedId: controlledId,
  onSelectId,
  groupBy,
  renderGroupHeader,
}: {
  items: T[];
  getId: (item: T) => string;
  renderRow: (
    item: T,
    selected: boolean,
    onSelect: () => void,
  ) => React.ReactNode;
  renderPane: (item: T) => React.ReactNode;
  emptyHint: React.ReactNode;
  onAdd?: () => void;
  addTitle?: string;
  headerRight?: React.ReactNode;
  // Управляемый выбор (фаза «Запуск»: клик в матрице пред-выбирает блогера).
  // Без onSelectId — internal state, как у лонглиста.
  selectedId?: string | null;
  onSelectId?: (id: string | null) => void;
  // Группировка списка (опц.): items должны быть отсортированы по группе, заголовок
  // вставляется при смене группы.
  groupBy?: (item: T) => string;
  renderGroupHeader?: (groupKey: string, count: number) => React.ReactNode;
}) {
  const [internalId, setInternalId] = useState<string | null>(null);
  const controlled = onSelectId !== undefined;
  const selectedId = controlled ? (controlledId ?? null) : internalId;
  const setSelectedId = controlled ? onSelectId! : setInternalId;
  const selected = items.find((i) => getId(i) === selectedId) ?? null;

  // Держим валидный выбор: по умолчанию первый; выбывшего (ушёл/удалён)
  // заменяем на следующего, чтобы не утыкаться в пустую панель.
  useEffect(() => {
    const first = items[0];
    if (!first) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !items.some((i) => getId(i) === selectedId)) {
      setSelectedId(getId(first));
    }
  }, [items, selectedId, getId, setSelectedId]);

  const listNodes: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  for (const item of items) {
    const id = getId(item);
    if (groupBy) {
      const g = groupBy(item);
      if (g !== lastGroup) {
        lastGroup = g;
        const count = items.filter((i) => groupBy(i) === g).length;
        listNodes.push(
          <Fragment key={`__h_${g}`}>
            {renderGroupHeader?.(g, count)}
          </Fragment>,
        );
      }
    }
    listNodes.push(
      <Fragment key={id}>
        {renderRow(item, id === selectedId, () => setSelectedId(id))}
      </Fragment>,
    );
  }

  return (
    <div className="flex h-full min-h-[440px] overflow-hidden border-y border-zinc-200 bg-white">
      <div className="flex w-[280px] shrink-0 flex-col border-r border-zinc-100">
        {(onAdd || headerRight) && (
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2">
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                title={addTitle}
                aria-label={addTitle}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700"
              >
                <Plus size={18} />
              </button>
            )}
            {headerRight != null && (
              <div className="min-w-0 flex-1 truncate text-xs text-zinc-500">
                {headerRight}
              </div>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-sm text-zinc-500">{emptyHint}</div>
          ) : (
            listNodes
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        {selected ? (
          // key — пересоздать панель при смене выбранного (re-init draft'а).
          <Fragment key={getId(selected)}>{renderPane(selected)}</Fragment>
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
            {items.length === 0 ? "" : "Выберите слева"}
          </div>
        )}
      </div>
    </div>
  );
}

// Добавить блогеров в лонглист (этап 16.8): только импорт каналов, без запуска
// рассылки. Каналы сразу сканируются (метрики/описание) и сопоставляются с
// базой. В активной кампании доливку планирует бэк (контактные — в аутрич).
// Запустить аутрич (этап 16.8): доступно в draft, когда у всех каналов есть
// контакт (жёсткий гейт; бэк тоже проверяет и вернёт 400). Правим цепочку и
// активируем. Опенер один на админа; {{каналы}} → его каналы через запятую:
// TG как @username, YouTube/TikTok/Дзен — ссылкой.
const LAUNCH_VARIABLES = [
  { key: "каналы", label: "@username'ы и ссылки каналов админа" },
];
function LaunchModal({
  wsId,
  campaign,
  onClose,
}: {
  wsId: string;
  campaign: Campaign;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const projectId = campaign.id;
  const baseOpener: Opener = campaign.opener;
  const [opener, setOpener] = useState<Opener>(baseOpener);
  const openerDirty = JSON.stringify(opener) !== JSON.stringify(baseOpener);
  const openerEmpty = !opener.text.trim();

  const launch = useMutation({
    mutationFn: async () => {
      if (openerDirty) {
        const { error } = await api.PATCH(
          "/v1/workspaces/{wsId}/projects/{projectId}",
          { params: { path: { wsId, projectId } }, body: { opener } },
        );
        if (error) throw error;
      }
      const { error: actErr } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/activate",
        { params: { path: { wsId, projectId } } },
      );
      if (actErr) throw actErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] });
      onClose();
    },
  });

  return (
    <Modal onClose={onClose} size="lg">
      <h2 className="mb-1 text-base font-semibold">Запустить аутрич</h2>
      <p className="mb-4 text-xs text-zinc-500">
        Первое сообщение уйдёт админам лонглиста через ваши Telegram-аккаунты в
        человеческом темпе. Один опенер на админа:{" "}
        <code className="rounded bg-zinc-100 px-1">{"{{каналы}}"}</code>{" "}
        подставит @username его канала (YouTube/TikTok — ссылкой), а если
        каналов несколько — все через запятую.
      </p>
      <OpenerEditor
        value={opener}
        onChange={setOpener}
        variables={LAUNCH_VARIABLES}
      />
      {launch.error && (
        <p className="mt-2 text-sm text-red-600">{errorMessage(launch.error)}</p>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          disabled={openerEmpty || launch.isPending}
          onClick={() => launch.mutate()}
          title={openerEmpty ? "Сначала задайте опенер" : undefined}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send size={15} />
          {launch.isPending ? "Запускаем…" : "Запустить аутрич"}
        </button>
      </div>
    </Modal>
  );
}

// Строка списка блогеров (этап 16.10, BD-кокпит): кто/что отправлено и ответ +
// непрочитанные в реал-тайме + хинт «ещё N у админа». Маркер только когда
// контакта нет (он actionable). Шум (цена/«контакт есть»/клиент-статус) убран.
function BloggerRow({
  p,
  selected,
  onSelect,
  siblingCount,
}: {
  p: Placement;
  selected: boolean;
  onSelect: () => void;
  siblingCount: number;
}) {
  const ch = p.channel;
  // Авто-рассылка уходит только живому человеку-контакту с получателем.
  // Бот / группа / личка-канала / контакт без @ — готов, но ВРУЧНУЮ (опенер
  // не шлётся, менеджер пишет сам).
  const isAuto = !!p.adminContactId && !p.adminIsBot && p.hasRecipient;
  const isManualReady = p.contactReady && !isAuto;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        "flex w-full items-start gap-2.5 border-b border-zinc-100 px-3 py-2.5 text-left " +
        (selected ? "bg-emerald-50" : "hover:bg-zinc-50")
      }
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Users size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            {ch?.title ?? "Канал удалён"}
          </div>
          {ch && (
            <ChannelBadges
              username={ch.username}
              isRkn={ch.isRkn}
              memberCount={ch.memberCount}
            />
          )}
          {p.unread > 0 && (
            <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
              {p.unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          {ch && <PlatformBadge platform={ch.platform} />}
          <span className="truncate">
            {ch?.username ? `@${ch.username}` : "—"}
            {siblingCount > 0 && (
              <span className="text-zinc-400"> · ещё {siblingCount} у админа</span>
            )}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <OutreachStatus p={p} />
          {!p.contactReady && (
            <span className="text-[11px] font-medium text-amber-600">
              нет контакта
            </span>
          )}
          {isManualReady && (
            <span
              title="Способ связи ручной (бот/группа/личка) — авто-опенер не уйдёт, напишите сами"
              className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500"
            >
              вручную
            </span>
          )}
          {p.teamKnowsAdmin && (
            <span
              title="Кто-то из аккаунтов команды уже в личном диалоге с этим админом"
              className="shrink-0 rounded-full bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-700"
            >
              🤝 знакомы
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Фаза 3: Согласование клиентом ──────────────────────────────────────────
function ReviewPhase({
  wsId,
  campaign,
}: {
  wsId: string;
  campaign: Campaign;
}) {
  const projectId = campaign.id;
  const shortlistQ = useQuery({
    queryKey: ["placements", wsId, projectId, "shortlist"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId }, query: { stage: "shortlist" } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const shortlist = shortlistQ.data ?? [];
  const decided = shortlist.filter((p) => p.clientStatus !== "pending").length;
  const finalizedAt = campaign.clientFinalizedAt;
  const qc = useQueryClient();
  const unfinalize = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/unfinalize",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] }),
  });

  // Блогер может написать на согласовании («передумал») — даём знать live:
  // бейдж unread на строке + доступ к чату по клику (оверлей).
  const live = campaign.status === "active" || campaign.status === "paused";
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/projects/${projectId}/stream` : null,
    "changed",
    () => qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  );
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/contact-stream` : null,
    "contact",
    () => qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  );
  const accountsQ = useOutreachAccounts(wsId);
  const [chatFor, setChatFor] = useState<Placement | null>(null);

  // Клиентский срез (Задача 3) прячет «серые» финансовые колонки — закупку,
  // надбавку, к оплате блогеру, прибыль. Внутренний — вся цепочка + P&L.
  const [view, setView] = useState<"internal" | "client">("internal");
  const internalView = view === "internal";

  // Цена каждой строки — через единый движок из полей блогера × множителей
  // кампании (Срез А: не legacy clientPrice, а посчитанная цепочка). Прогноз для
  // CPV — снапшот forecastViews или живой охват канала.
  const priced = shortlist.map((p) => {
    const forecast = p.forecastViews ?? p.channel?.avgReach ?? null;
    return { p, forecast, pricing: placementPricing(campaign, p, forecast) };
  });
  const T = priced.reduce(
    (a, { p, forecast, pricing }) => ({
      views: a.views + (forecast ?? 0),
      net: a.net + (p.priceAmount ?? 0),
      beforeAk: a.beforeAk + pricing.beforeAk,
      createPart: a.createPart + pricing.createPart,
      placePart: a.placePart + pricing.placePart,
      clientNoVat: a.clientNoVat + pricing.clientNoVat,
      clientVat: a.clientVat + pricing.clientVat,
      profit: a.profit + pricing.profit,
    }),
    {
      views: 0,
      net: 0,
      beforeAk: 0,
      createPart: 0,
      placePart: 0,
      clientNoVat: 0,
      clientVat: 0,
      profit: 0,
    },
  );
  const margin = T.clientNoVat > 0 ? (T.profit / T.clientNoVat) * 100 : 0;

  return (
    <div className="space-y-4">
      <ShareAccessBlock
        wsId={wsId}
        projectId={projectId}
        clientStep={PHASE_CLIENT_STEP.review!}
      />

      {finalizedAt && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm">
          <span className="text-emerald-800">
            Клиент финализировал медиаплан · {formatPastRelative(finalizedAt)}.
            Решения заморожены.
          </span>
          <button
            type="button"
            onClick={() => unfinalize.mutate()}
            disabled={unfinalize.isPending}
            className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
          >
            Переоткрыть
          </button>
        </div>
      )}

      {shortlist.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Шортлист пуст. Вернитесь в Лонглист и добавьте собранных блогеров
          кнопкой «В шортлист».
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-zinc-500">
              В шортлисте {shortlist.length} · решений клиента {decided}/
              {shortlist.length}
              {internalView && (
                <span className="ml-2 text-zinc-400">
                  · АК {campaign.akPercent}%
                  {campaign.ordEnabled ? " · +3% ОРД" : ""} · НДС{" "}
                  {campaign.vatEnabled ? campaign.vatRate + "%" : "—"}
                  {campaign.splitEnabled ? " · сплит созд/разм" : ""}
                </span>
              )}
            </div>
            <div className="inline-flex overflow-hidden rounded-lg border border-zinc-200 text-xs">
              {(["client", "internal"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={
                    "px-3 py-1.5 font-medium " +
                    (view === v
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-500 hover:bg-zinc-50")
                  }
                >
                  {v === "client" ? "Клиентский вид" : "Внутренний вид"}
                </button>
              ))}
            </div>
          </div>
          <TableCard>
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <Th>Канал</Th>
                <Th className="text-right">Подписчики</Th>
                <Th className="text-right">Прогноз</Th>
                <Th className="text-right">ERR</Th>
                <Th className="text-right">CPV</Th>
                {internalView && (
                  <Th className="border-l border-dashed border-zinc-300 text-right">
                    Чистая блогеру
                  </Th>
                )}
                {internalView && <Th className="text-right">Надбавка</Th>}
                {internalView && (
                  <Th className="text-right">К оплате блогеру</Th>
                )}
                <Th className="border-l border-dashed border-zinc-300 text-right">
                  Клиенту до НДС
                </Th>
                {campaign.vatEnabled && (
                  <Th className="text-right">Клиенту с НДС</Th>
                )}
                {internalView && <Th className="text-right">Прибыль GI</Th>}
                <Th>Решение клиента</Th>
                <Th>Комментарий</Th>
              </tr>
            </thead>
            <tbody>
              {priced.map(({ p, forecast, pricing }) => {
                const cs = clientView[p.clientStatus];
                return (
                  <tr key={p.id} className="border-t border-zinc-100">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <ChannelCell placement={p} preview />
                        {p.adminContactId && (
                          <button
                            type="button"
                            onClick={() => setChatFor(p)}
                            title="Переписка с админом"
                            className="relative shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                          >
                            <MessageCircle size={15} />
                            {p.unread > 0 && (
                              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white">
                                {p.unread}
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {formatViews(p.channel?.memberCount ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {formatViews(forecast)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {p.channel?.err != null ? p.channel.err + "%" : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {forecast ? cpv(pricing.clientNoVat, forecast) : "—"}
                    </td>
                    {internalView && (
                      <td className="border-l border-dashed border-zinc-200 bg-zinc-50/60 px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {formatRub(p.priceAmount)}
                      </td>
                    )}
                    {internalView && (
                      <td className="bg-zinc-50/60 px-4 py-2.5 text-right tabular-nums text-zinc-500">
                        {p.surchargePercent
                          ? `+${p.surchargePercent}%`
                          : "—"}
                        {p.bloggerVat && (
                          <span className="ml-1 rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
                            НДС
                          </span>
                        )}
                      </td>
                    )}
                    {internalView && (
                      <td className="bg-zinc-50/60 px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {formatRub(pricing.beforeAk)}
                        {campaign.splitEnabled && p.createShare != null && (
                          <div className="text-[10px] font-normal text-zinc-400">
                            созд {formatRub(pricing.createPart)} ·
                            разм {formatRub(pricing.placePart)}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="border-l border-dashed border-zinc-200 px-4 py-2.5 text-right tabular-nums font-medium text-zinc-900">
                      {formatRub(pricing.clientNoVat)}
                    </td>
                    {campaign.vatEnabled && (
                      <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                        {formatRub(pricing.clientVat)}
                      </td>
                    )}
                    {internalView && (
                      <td className="bg-zinc-50/60 px-4 py-2.5 text-right tabular-nums text-emerald-700">
                        {formatRub(pricing.profit)}
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <Chip tone={cs.tone}>{cs.label}</Chip>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-zinc-500">
                      {p.clientStatusComment ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50 font-medium text-zinc-800">
              <tr>
                <td className="px-4 py-2.5" colSpan={2}>
                  Итого ({shortlist.length})
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatViews(T.views || null)}
                </td>
                <td />
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {T.views > 0 ? cpv(T.clientNoVat, T.views) : "—"}
                </td>
                {internalView && (
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatRub(T.net)}
                  </td>
                )}
                {internalView && <td />}
                {internalView && (
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatRub(T.beforeAk)}
                  </td>
                )}
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatRub(T.clientNoVat)}
                </td>
                {campaign.vatEnabled && (
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatRub(T.clientVat)}
                  </td>
                )}
                {internalView && (
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">
                    {formatRub(T.profit)}
                  </td>
                )}
                <td colSpan={2} />
              </tr>
            </tfoot>
          </TableCard>

          {internalView && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Stat
                label="Σ к оплате блогерам, до НДС"
                value={formatRub(T.beforeAk)}
              />
              <Stat
                label="Σ к оплате Go Influence, до НДС"
                value={formatRub(T.clientNoVat)}
              />
              <Stat
                label={
                  campaign.vatEnabled
                    ? "Клиентский бюджет, с НДС"
                    : "Клиентский бюджет"
                }
                value={formatRub(
                  campaign.vatEnabled ? T.clientVat : T.clientNoVat,
                )}
              />
              <Stat
                label="Прибыль Go Influence"
                value={formatRub(T.profit)}
              />
              <Stat label="Маржинальность" value={margin.toFixed(1) + "%"} />
              {campaign.splitEnabled && (
                <>
                  <Stat
                    label="Σ за создание (без ОРД)"
                    value={formatRub(T.createPart)}
                  />
                  <Stat
                    label="Σ за размещение (+3%)"
                    value={formatRub(T.placePart)}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}

      {chatFor?.adminContactId && (
        <LeadChatDrawer
          wsId={wsId}
          lead={{
            id: chatFor.id,
            contactId: chatFor.adminContactId,
            account: null,
          }}
          accounts={accountsQ.data ?? []}
          onClose={() => setChatFor(null)}
        />
      )}
    </div>
  );
}

// Блок выдачи magic-link: создать ссылку (без email), скопировать, отозвать.
// Кнопка «скопировать ссылку клиенту» с deep-link на нужный этап портала.
// Используется в фазах Запуск/Отчёт; запрос shares кэш-дедуплится с другими.
function CopyShareLink({
  wsId,
  projectId,
  step,
  label,
  className,
}: {
  wsId: string;
  projectId: string;
  step: ShareStep;
  label: string;
  className: string;
}) {
  const sharesQ = useProjectShares(wsId, projectId);
  const share = sharesQ.data?.[0];
  const [copied, setCopied] = useState(false);
  if (!share) return null;
  const link = shareDeepLink(window.location.origin + share.url, step);
  const copy = () => {
    void copyText(link).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button type="button" onClick={copy} title={link} className={className}>
      <Link2 size={13} />
      {copied ? "Скопировано" : label}
    </button>
  );
}

function ShareAccessBlock({
  wsId,
  projectId,
  clientStep,
}: {
  wsId: string;
  projectId: string;
  // Этап, на который откроется клиентский портал по этой ссылке (на каком этапе
  // менеджер копирует, тот и будет). На «Согласовании» это блогеры.
  clientStep: ShareStep;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const sharesQ = useProjectShares(wsId, projectId);
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/shares",
        { params: { path: { wsId, projectId } }, body: {} },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.shares(wsId, projectId) }),
  });
  const revoke = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/projects/{projectId}/shares/{shareId}",
        { params: { path: { wsId, projectId, shareId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: OUTREACH_QK.shares(wsId, projectId) }),
  });

  const shares = sharesQ.data ?? [];
  const primary = shares[0] ?? null;
  const fullUrl = (url: string) =>
    shareDeepLink(window.location.origin + url, clientStep);
  const primaryUrl = primary ? fullUrl(primary.url) : "";
  const copy = (rawUrl: string) => {
    const f = fullUrl(rawUrl);
    void copyText(f).then((ok) => {
      if (!ok) return;
      setCopied(f);
      setTimeout(() => setCopied((c) => (c === f ? null : c)), 1500);
    });
  };

  // Ссылка для клиента существует всегда: если её нет (новый проект или менеджер
  // отозвал все) — создаём одну. autoCreated-ref + isPending-гард защищают от
  // дубля в рамках одного маунта (StrictMode/гонка до рефетча). Зашёл в фазу,
  // ссылок нет → снова одна — это и есть задуманное «ссылка всегда под рукой».
  const autoCreated = useRef(false);
  useEffect(() => {
    if (!sharesQ.isSuccess || autoCreated.current) return;
    if (shares.length === 0 && !create.isPending) {
      autoCreated.current = true;
      create.mutate();
    }
  }, [sharesQ.isSuccess, shares.length, create]);

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-zinc-500">
        Ссылка для клиента — видит каналы и метрики (без ваших цен), ставит
        «подходит / не подходит».
      </p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={primaryUrl || "Создаётся…"}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => primary && copy(primary.url)}
          disabled={!primary}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          {copied === primaryUrl && primaryUrl ? "Скопировано" : "Копировать"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Редактировать
        </button>
      </div>

      {editing && (
        <Modal onClose={() => setEditing(false)} size="md">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900">
              Ссылки для клиента
            </h2>
            <p className="text-xs text-zinc-500">
              Можно выдать несколько (например, разным контактам клиента). Отзыв
              убивает доступ по конкретной ссылке.
            </p>
            {shares.length === 0 ? (
              <p className="text-sm text-zinc-500">Ссылок нет.</p>
            ) : (
              <div className="space-y-1.5">
                {shares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <code className="min-w-0 flex-1 truncate text-xs text-zinc-600">
                      {fullUrl(s.url)}
                    </code>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {s.lastSeenAt
                        ? `открыто ${formatPastRelative(s.lastSeenAt)}`
                        : "не открывали"}
                    </span>
                    <button
                      type="button"
                      onClick={() => copy(s.url)}
                      className="shrink-0 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      {copied === fullUrl(s.url) ? "Скопировано" : "Скопировать"}
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke.mutate(s.id)}
                      disabled={revoke.isPending}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:text-red-600 disabled:opacity-50"
                    >
                      Отозвать
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => create.mutate()}
              disabled={create.isPending}
              className="w-full rounded-lg border border-dashed border-zinc-300 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {create.isPending ? "Создаём…" : "+ Создать новую ссылку"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Фаза 4: Подтверждение (bulk-send по шортлисту) ──────────────────────────
function ShortlistPhase({
  wsId,
  campaign,
}: {
  wsId: string;
  campaign: Campaign;
}) {
  const projectId = campaign.id;
  const qc = useQueryClient();
  const shortlistQ = useQuery({
    queryKey: ["placements", wsId, projectId, "shortlist"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId }, query: { stage: "shortlist" } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const approved = (shortlistQ.data ?? []).filter(
    (p) => p.clientStatus === "approved",
  );
  // Блогер может ответить на оффер — live-обновляем список (бейдж/чат).
  const live = campaign.status === "active" || campaign.status === "paused";
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/projects/${projectId}/stream` : null,
    "changed",
    () => qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  );
  useEventSourceEvent(
    live ? `/v1/workspaces/${wsId}/contact-stream` : null,
    "contact",
    () => qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  );
  const accountsQ = useOutreachAccounts(wsId);
  const [chatFor, setChatFor] = useState<Placement | null>(null);
  // Кому ещё не ушёл оффер (или ушёл с ошибкой) — только им шлёт «оповестить».
  const notOffered = approved.filter(
    (p) =>
      p.hasRecipient &&
      (p.finalOfferStatus === "none" || p.finalOfferStatus === "failed"),
  ).length;
  const [text, setText] = useState(
    "Привет! Рады сообщить — вы выбраны в проект. Давайте согласуем дату выхода и детали 🙌",
  );

  const send = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/final-offer",
        { params: { path: { wsId, projectId } }, body: { text } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["placements", wsId, projectId, "shortlist"],
      }),
  });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Подтверждение блогерам
          </h2>
          <p className="text-xs text-zinc-500">
            Одобренным клиентом блогерам — одно сообщение «вы выбраны».
            Отправляется через ваши Telegram-аккаунты в человеческом темпе
            (тот же worker, что и цепочки), без авто-пингов.
          </p>
        </div>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={notOffered === 0 || send.isPending || !text.trim()}
            onClick={() => send.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send size={15} />
            {send.isPending
              ? "Ставим в очередь…"
              : notOffered === 0
                ? "Все оповещены"
                : `Отправить ${notOffered} блогерам`}
          </button>
          {send.data && (
            <span className="text-sm text-zinc-600">
              {send.data.scheduled} в очереди — worker отправит
            </span>
          )}
          {send.error && (
            <span className="text-sm text-red-600">
              {errorMessage(send.error)}
            </span>
          )}
        </div>
      </div>

      {approved.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Клиент ещё никого не одобрил. Вернитесь в «Согласование».
        </div>
      ) : (
        <TableCard>
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <Th>Канал</Th>
              <Th>Подтверждение</Th>
            </tr>
          </thead>
          <tbody>
            {approved.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <ChannelCell placement={p} />
                    {p.adminContactId && (
                      <button
                        type="button"
                        onClick={() => setChatFor(p)}
                        title="Переписка с админом"
                        className="relative shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                      >
                        <MessageCircle size={15} />
                        {p.unread > 0 && (
                          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-semibold leading-none text-white">
                            {p.unread}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {p.finalOfferStatus === "sent" ? (
                    <Chip tone="emerald">отправлен</Chip>
                  ) : p.finalOfferStatus === "queued" ? (
                    <Chip tone="amber">в очереди</Chip>
                  ) : p.finalOfferStatus === "failed" ? (
                    <Chip tone="red">ошибка</Chip>
                  ) : (
                    <span className="text-xs text-zinc-400">не отправлен</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {chatFor?.adminContactId && (
        <LeadChatDrawer
          wsId={wsId}
          lead={{
            id: chatFor.id,
            contactId: chatFor.adminContactId,
            account: null,
          }}
          accounts={accountsQ.data ?? []}
          onClose={() => setChatFor(null)}
        />
      )}
    </div>
  );
}

// ── Фаза 5: Запуск (pipeline-матрица) ───────────────────────────────────────
function ProductionPhase({
  wsId,
  campaign,
}: {
  wsId: string;
  campaign: Campaign;
}) {
  const projectId = campaign.id;
  // Два независимых представления + тумблер (запоминаем выбор). «Вертолёт» —
  // матрица-обзор всей воронки; «Инбокс» — работа с одним блогером (шаги + чат).
  const [creativePreview, setCreativePreview] = useState<{
    placementId: string;
    title: string;
  } | null>(null);
  const [view, setView] = useState<"matrix" | "inbox">(
    () =>
      (localStorage.getItem("zapusk-view") as "matrix" | "inbox" | null) ??
      "matrix",
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowsQ = useQuery({
    queryKey: ["placements", wsId, projectId, "shortlist"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId }, query: { stage: "shortlist" } } },
      );
      if (error) throw error;
      return data;
    },
  });
  // Одобренные клиентом, отсортированы «на нас → клиент → блогер → готово»:
  // и в матрице, и в инбокс-списке актуальное для менеджера сверху.
  const rows = (rowsQ.data ?? [])
    .filter((p) => p.clientStatus === "approved")
    .sort(
      (a, b) =>
        PROD_OWNER_ORDER.indexOf(deriveProduction(a).owner) -
        PROD_OWNER_ORDER.indexOf(deriveProduction(b).owner),
    );

  // Ссылка клиенту — под рукой и на «Запуске» (согласование креативов идёт здесь).

  const pickView = (v: "matrix" | "inbox") => {
    setView(v);
    localStorage.setItem("zapusk-view", v);
  };
  // Клик по строке матрицы открывает этого блогера в инбоксе (не морфинг —
  // просто переключение вью с пред-выбором).
  const openInInbox = (id: string) => {
    setSelectedId(id);
    pickView("inbox");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 bg-white px-4 py-2.5">
        <div className="inline-flex rounded-lg border border-zinc-300 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => pickView("matrix")}
            className={
              "rounded-md px-3 py-1 font-medium " +
              (view === "matrix"
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100")
            }
          >
            Вертолёт
          </button>
          <button
            type="button"
            onClick={() => pickView("inbox")}
            className={
              "rounded-md px-3 py-1 font-medium " +
              (view === "inbox"
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100")
            }
          >
            Инбокс
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {PROD_OWNER_ORDER.map((o) => (
            <span key={o} className="flex items-center gap-1">
              <span
                className={"h-1.5 w-1.5 rounded-full " + PROD_OWNER[o].dot}
              />
              {PROD_OWNER[o].label}
            </span>
          ))}
        </div>
        <CopyShareLink
          wsId={wsId}
          projectId={projectId}
          step={PHASE_CLIENT_STEP.production!}
          label="Ссылка клиенту"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
        />
      </div>

      {rows.length === 0 ? (
        <div className="border-y border-zinc-200 bg-white px-6 py-6 text-sm text-zinc-500">
          Нет одобренных размещений. Запуск стартует после согласования
          клиентом.
        </div>
      ) : view === "matrix" ? (
        <div className="min-h-0 flex-1 overflow-auto border-y border-zinc-200 bg-white">
          <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <Th>Канал</Th>
              <Th>Договор</Th>
              <Th>Креатив</Th>
              <Th>Дата</Th>
              <Th>ЕРИД</Th>
              <Th>Публикация</Th>
              <Th>Акт</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const ct = contractView[contractState(p)];
              const cr = creativeView[p.creativeStatus];
              const prod = deriveProduction(p);
              const o = PROD_OWNER[prod.owner];
              return (
                <tr
                  key={p.id}
                  onClick={() => openInInbox(p.id)}
                  className={
                    "cursor-pointer border-t border-l-4 border-zinc-100 hover:bg-zinc-50 " +
                    o.border
                  }
                >
                  <td className="px-4 py-2.5">
                    <ChannelCell placement={p} />
                    <div className="mt-1 flex items-center gap-1.5">
                      <span
                        className={"h-1.5 w-1.5 rounded-full " + o.dot}
                      />
                      <span className="text-xs text-zinc-500">
                        {prod.stage}
                      </span>
                      {prod.owner === "us" && prod.cta && (
                        <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
                          → {prod.cta}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone={ct.tone}>{ct.label}</Chip>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Chip tone={cr.tone}>
                        {cr.label}
                        {p.creativeRound > 1 ? ` · v${p.creativeRound}` : ""}
                      </Chip>
                      {p.stepMessages?.creative && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCreativePreview({
                              placementId: p.id,
                              title: p.channel?.title ?? "Креатив",
                            });
                          }}
                          className="text-xs text-emerald-700 hover:underline"
                        >
                          превью
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-zinc-700">
                    {p.scheduledAt ? (
                      p.scheduledAt.slice(0, 10)
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.erid ? (
                      <Chip tone="emerald">есть</Chip>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.publishedAt ? (
                      <Chip tone="emerald">вышел</Chip>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.actReceivedAt ? (
                      <Chip tone="emerald">получен</Chip>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          </table>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <InboxShell
            items={rows}
            getId={(p) => p.id}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            groupBy={(p) => deriveProduction(p).owner}
            renderGroupHeader={(g, count) => {
              const o = PROD_OWNER[g as ProdOwner];
              return (
                <div
                  className={
                    "px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide " +
                    o.text
                  }
                >
                  {o.label} · {count}
                </div>
              );
            }}
            emptyHint=""
            renderRow={(p, selected, onSelect) => {
              const prod = deriveProduction(p);
              const o = PROD_OWNER[prod.owner];
              return (
                <button
                  type="button"
                  onClick={onSelect}
                  className={
                    "block w-full border-l-2 px-3 py-2 text-left " +
                    (selected
                      ? o.border + " " + o.soft
                      : "border-l-transparent hover:bg-zinc-50")
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={"h-1.5 w-1.5 shrink-0 rounded-full " + o.dot}
                    />
                    {p.channel && (
                      <PlatformBadge platform={p.channel.platform} />
                    )}
                    <span className="truncate text-sm font-medium text-zinc-900">
                      {p.channel?.title ?? "Канал удалён"}
                    </span>
                  </div>
                  <div className="ml-3.5 truncate text-xs text-zinc-500">
                    {prod.stage}
                  </div>
                </button>
              );
            }}
            renderPane={(p) => (
              <ProductionPane
                wsId={wsId}
                projectId={projectId}
                placement={p}
                advertiserData={campaign.advertiserData}
              />
            )}
          />
        </div>
      )}

      {creativePreview && (
        <ChannelPreviewDrawer
          title={`Креатив · ${creativePreview.title}`}
          queryKey={[
            "step-message",
            wsId,
            projectId,
            creativePreview.placementId,
            "creative",
          ]}
          queryFn={async () => {
            const { data, error } = await api.GET(
              "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
              {
                params: {
                  path: {
                    wsId,
                    projectId,
                    placementId: creativePreview.placementId,
                    kind: "creative",
                  },
                },
              },
            );
            if (error) throw error;
            return data!.messages as ChannelMessage[];
          }}
          onClose={() => setCreativePreview(null)}
        />
      )}
    </div>
  );
}

// ── Фаза 6: Отчёт ───────────────────────────────────────────────────────────
// Метрики вышедших постов снимаются metrics-worker'ом через TDLib (openChat +
// viewMessages, не bulk-pull). Кнопка ставит размещения в pending; пока есть
// pending — поллим. Снимок поста (текст + минитамбнейл) показываем как карточку.
function WrapupPhase({ wsId, campaign }: { wsId: string; campaign: Campaign }) {
  const projectId = campaign.id;
  const qc = useQueryClient();
  const rowsQ = useQuery({
    queryKey: ["placements", wsId, projectId, "shortlist"] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId }, query: { stage: "shortlist" } } },
      );
      if (error) throw error;
      return data;
    },
    // Пока worker разбирает очередь — поллим. Условие по тому же набору, что
    // видимые строки (approved+postUrl), иначе поллинг и pendingCount
    // рассинхронятся: спиннер крутится вечно либо не появляется вовсе.
    refetchInterval: (q) =>
      (q.state.data ?? []).some(
        (p) =>
          p.clientStatus === "approved" &&
          p.postUrl &&
          p.metricsStatus === "pending",
      )
        ? 3000
        : false,
  });

  // Отчёт — про вышедшие посты: одобренные клиентом размещения с post_url.
  const rows = (rowsQ.data ?? []).filter(
    (p) => p.clientStatus === "approved" && p.postUrl,
  );
  const pendingCount = rows.filter((p) => p.metricsStatus === "pending").length;
  // SSE: metrics-worker шлёт emitProjectChanged после КАЖДОГО снятого поста —
  // подхватываем сразу (мгновенный прогресс), пока есть pending. Поллинг выше
  // остаётся тонким fallback'ом на случай обрыва стрима.
  useEventSourceEvent(
    pendingCount > 0
      ? `/v1/workspaces/${wsId}/projects/${projectId}/stream`
      : null,
    "changed",
    () =>
      qc.invalidateQueries({
        queryKey: ["placements", wsId, projectId, "shortlist"],
      }),
  );

  const collect = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/collect-metrics",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["placements", wsId, projectId, "shortlist"],
      }),
  });

  // Отчёт считаем по ЦЕНЕ КЛИЕНТА (посчитанная цепочка, Срез А), не по закупке —
  // чтобы бюджет/CPV совпадали с медиапланом и клиентским порталом. Прогноз для
  // план-факта — снапшот forecastViews (что обещали) или живой охват.
  const priced = rows.map((p) => {
    const forecast = p.forecastViews ?? p.channel?.avgReach ?? null;
    return { p, forecast, price: placementPricing(campaign, p, forecast).clientNoVat };
  });
  const totalBudget = priced.reduce((s, r) => s + r.price, 0);
  const totalForecast = priced.reduce((s, r) => s + (r.forecast ?? 0), 0);
  // Средний CPV факт — по строкам с реально снятыми просмотрами: иначе бюджет
  // ещё-не-снятых попадёт в числитель при нуле в знаменателе → CPV завышается
  // в разы и «прыгает» вниз по мере добора метрик.
  const measured = priced.filter((r) => r.p.metricsViews !== null);
  const measuredViews = measured.reduce((s, r) => s + (r.p.metricsViews ?? 0), 0);
  const measuredBudget = measured.reduce((s, r) => s + r.price, 0);
  // Прогнозный CPV — та же симметрия: числитель только по строкам, у которых
  // есть прогноз, иначе цена forecast-less строк раздула бы CPV при нуле в знаменателе.
  const forecastBudget = priced
    .filter((r) => r.forecast != null)
    .reduce((s, r) => s + r.price, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Отчёт по кампании</h2>
        <div className="flex items-center gap-2">
          <CopyShareLink
            wsId={wsId}
            projectId={projectId}
            step={PHASE_CLIENT_STEP.wrapup!}
            label="Ссылка на отчёт"
            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          />
          <button
            type="button"
            onClick={() => collect.mutate()}
            disabled={collect.isPending || pendingCount > 0 || rows.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw size={15} className={pendingCount > 0 ? "animate-spin" : ""} />
            {pendingCount > 0 ? `Снимаем… ${pendingCount}` : "Снять статистику со всех"}
          </button>
        </div>
      </div>

      {pendingCount > 0 &&
        (() => {
          const completed = rows.length - pendingCount;
          return (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Снимаем статистику…</span>
                <span>
                  {completed} из {rows.length}
                </span>
              </div>
              <ProgressBar
                pct={Math.round((completed / rows.length) * 100)}
              />
            </div>
          );
        })()}

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Нет вышедших постов. Отчёт собирается после публикации размещений
          (фаза «Запуск» → ссылка на пост).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Постов вышло" value={String(rows.length)} />
            <Stat
              label="Σ просмотров (факт)"
              value={formatViews(measuredViews)}
              sub={
                totalForecast > 0
                  ? `прогноз ${formatViews(totalForecast)}`
                  : undefined
              }
            />
            <Stat label="Σ бюджет клиенту" value={formatRub(totalBudget)} />
            <Stat
              label="Средний CPV (факт)"
              value={
                measured.length > 0 ? cpv(measuredBudget, measuredViews) : "—"
              }
              sub={
                totalForecast > 0
                  ? `прогноз ${cpv(forecastBudget, totalForecast)}`
                  : undefined
              }
            />
          </div>

          <TableCard>
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <Th>Канал</Th>
                <Th>Пост</Th>
                <Th className="text-right">Прогноз</Th>
                <Th className="text-right">
                  <Eye size={13} className="inline" /> факт
                </Th>
                <Th className="text-right">
                  <Heart size={13} className="inline" />
                </Th>
                <Th className="text-right">
                  <MessageCircle size={13} className="inline" />
                </Th>
                <Th className="text-right">
                  <Repeat2 size={13} className="inline" />
                </Th>
                <Th className="text-right">CPV факт</Th>
                <Th>Дата выхода</Th>
                <Th>Снято</Th>
              </tr>
            </thead>
            <tbody>
              {priced.map(({ p, forecast, price }) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2.5">
                    <ChannelCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <PostSnapshotCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-400">
                    {formatViews(forecast)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.metricsViews === null ? "—" : formatViews(p.metricsViews)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.metricsLikes ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.metricsComments ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.metricsShares ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {cpv(price, p.metricsViews)}
                  </td>
                  <td className="px-4 py-2.5">
                    <PublishDateCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <MetricsStatusCell placement={p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  // Вторая строка мелким серым — для план-факта («прогноз …» под фактом).
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

// Карточка вышедшего поста: минитамбнейл (base64 jpeg из TDLib payload) + текст.
function PostSnapshotCell({ placement }: { placement: Placement }) {
  const snap = placement.postSnapshot;
  // Обложка: YT/TikTok отдают URL (coverUrl), TG — base64-минитамбнейл.
  const cover = snap?.coverUrl
    ? snap.coverUrl
    : snap?.thumbB64
      ? `data:image/jpeg;base64,${snap.thumbB64}`
      : null;
  return (
    <div className="flex items-start gap-2">
      {cover ? (
        <img
          src={cover}
          alt=""
          className="h-10 w-10 shrink-0 rounded object-cover"
        />
      ) : null}
      <div className="min-w-0 max-w-xs">
        {snap?.text ? (
          <p className="line-clamp-2 text-xs text-zinc-600">{snap.text}</p>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        )}
        {placement.postUrl ? (
          <a
            href={placement.postUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-emerald-600 hover:underline"
          >
            открыть пост
          </a>
        ) : null}
      </div>
    </div>
  );
}

// Дата выхода поста (с временем) — кликабельна на сам пост (TG/YT/TikTok через
// postUrl). publishedAt подтягивается автоматически воркером из самого поста;
// fallback — вручную заданная дата выхода (scheduledAt).
function PublishDateCell({ placement }: { placement: Placement }) {
  const date = placement.publishedAt ?? placement.scheduledAt;
  if (!date) return <span className="text-xs text-zinc-400">—</span>;
  const label = formatDateTime(date);
  return placement.postUrl ? (
    <a
      href={placement.postUrl}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-emerald-600 hover:underline"
    >
      {label} ↗
    </a>
  ) : (
    <span className="text-xs text-zinc-600">{label}</span>
  );
}

function MetricsStatusCell({ placement }: { placement: Placement }) {
  const p = placement;
  if (p.metricsStatus === "pending")
    return <Chip tone="amber">снимаем…</Chip>;
  if (p.metricsStatus === "error")
    return (
      <span title={p.metricsError ?? undefined}>
        <Chip tone="red">ошибка</Chip>
      </span>
    );
  if (p.metricsCollectedAt)
    return (
      <span className="text-xs text-zinc-500">
        {formatPastRelative(p.metricsCollectedAt)}
      </span>
    );
  return <span className="text-xs text-zinc-400">—</span>;
}

// ── Общие мелочи ────────────────────────────────────────────────────────────

// Один компактный столбец аутрич-статуса (вместо колонки-на-сообщение):
// сворачивает «где блогер в воронке ответа» в одну строку.
function OutreachStatus({ p }: { p: Placement }) {
  if (p.chainStatus === "replied") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <MessageCircleReply size={13} />
        {p.repliedAt ? `ответил ${formatPastRelative(p.repliedAt)}` : "ответил"}
      </span>
    );
  }
  if (p.chainStatus === "declined") {
    return <span className="text-xs text-red-600">отказался</span>;
  }
  if (p.chainStatus === "read") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-blue-600">
        <CheckCheck size={13} /> прочитано
      </span>
    );
  }
  if (p.chainStatus === "sent") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-zinc-600">
        <Check size={13} /> отправлено {p.outreach.sentCount}/
        {p.outreach.totalSteps}
      </span>
    );
  }
  return <span className="text-xs text-zinc-400">не писали</span>;
}

// Клик по каналу открывает общий ChannelDrawer (лента постов, авто-синк
// статистики «открыл-актуализировалось», админы) — переиспользуем со страницы
// Каналов. stopPropagation, чтобы не сработал row-click (drawer размещения).
function ChannelCell({
  placement,
  preview,
}: {
  placement: Placement;
  // preview=true → лёгкий дровер из кэша (only_local, без сети) — для
  // согласования, где каналов много и не хочется флудить. Иначе полный дровер.
  preview?: boolean;
}) {
  const { wsId } = Route.useParams();
  const [open, setOpen] = useState(false);
  const ch = placement.channel;
  return (
    <>
      <button
        type="button"
        disabled={!ch}
        onClick={(e) => {
          e.stopPropagation();
          if (ch) setOpen(true);
        }}
        title={ch ? "Открыть канал: лента, статистика, админы" : undefined}
        className="-mx-1 flex items-center gap-2.5 rounded px-1 py-0.5 text-left hover:bg-zinc-100 disabled:hover:bg-transparent"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
          <Users size={14} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-900">
            {ch?.title ?? "Канал удалён"}
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            {ch && <PlatformBadge platform={ch.platform} />}
            <span className="truncate">
              {ch?.username ? `@${ch.username}` : "—"}
            </span>
          </div>
        </div>
      </button>
      {open && ch && (
        // Дровер живёт внутри ChannelCell, а та — внутри кликабельной строки
        // матрицы (onClick=openInInbox). React-события всплывают сквозь портал по
        // дереву компонентов, поэтому клик «Закрыть» долетал до строки и кидал в
        // инбокс. Гасим всплытие на обёртке.
        <span onClick={(e) => e.stopPropagation()}>
          {preview ? (
            <ChannelPreviewDrawer
              title={ch.title}
              queryKey={["channel-preview", wsId, ch.id]}
              queryFn={async () => {
                const { data, error } = await api.GET(
                  "/v1/workspaces/{wsId}/channels/{id}/preview",
                  { params: { path: { wsId, id: ch.id } } },
                );
                if (error) throw error;
                return data!.messages as ChannelMessage[];
              }}
              onClose={() => setOpen(false)}
            />
          ) : (
            <ChannelDrawer
              wsId={wsId}
              channelId={ch.id}
              onClose={() => setOpen(false)}
            />
          )}
        </span>
      )}
    </>
  );
}

function TableCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={"px-4 py-2 text-left font-normal " + className}>{children}</th>
  );
}

function PrimaryBtn({
  icon,
  children,
  onClick,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
    >
      {icon}
      {children}
    </button>
  );
}


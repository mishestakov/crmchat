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
import {
  MessagesEditor,
  newMessage,
  type Message,
} from "../../../../../components/messages-editor";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import {
  useOutreachAccounts,
  useProjectShares,
} from "../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../lib/query-keys";
import {
  type ShareStep,
  shareDeepLink,
} from "../../../../../lib/share-steps";
import { LeadChatDrawer } from "../../../../../components/lead-chat-drawer";
import { formatPastRelative } from "../../../../../lib/date-utils";
import {
  type PhaseKey,
  type Placement,
  type Campaign,
  PHASE_CLIENT_STEP,
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
  const [draft, setDraft] = useState(() => ({
    brief: campaign.brief ?? "",
    budgetAmount: campaign.budgetAmount?.toString() ?? "",
    periodStart: toDateInput(campaign.periodStart),
    periodEnd: toDateInput(campaign.periodEnd),
    tov: campaign.tov ?? "",
    constraints: campaign.constraints ?? "",
  }));
  const server = {
    brief: campaign.brief ?? "",
    budgetAmount: campaign.budgetAmount?.toString() ?? "",
    periodStart: toDateInput(campaign.periodStart),
    periodEnd: toDateInput(campaign.periodEnd),
    tov: campaign.tov ?? "",
    constraints: campaign.constraints ?? "",
  };
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
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaign", wsId, campaign.id] }),
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

  // Сколько ещё каналов у того же админа — для хинта «+N» в строке (этап 16.8).
  const adminCounts = useMemo(() => {
    const data = placementsQ.data ?? [];
    const src = showDeclined
      ? data
      : data.filter((p) => p.chainStatus !== "declined");
    const m = new Map<string, number>();
    for (const p of src) {
      if (p.adminContactId) {
        m.set(p.adminContactId, (m.get(p.adminContactId) ?? 0) + 1);
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
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200">
              <div
                className={
                  "h-full rounded-full " +
                  (unready === 0 && total > 0 ? "bg-emerald-500" : "bg-amber-400")
                }
                style={{ width: `${pct}%` }}
              />
            </div>
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
          emptyHint="Лонглист пуст. Нажмите «Добавить блогеров», чтобы импортировать каналы — они сразу просканируются."
          renderRow={(p, selected, onSelect) => (
            <BloggerRow
              p={p}
              selected={selected}
              onSelect={onSelect}
              siblingCount={
                p.adminContactId
                  ? (adminCounts.get(p.adminContactId) ?? 1) - 1
                  : 0
              }
            />
          )}
          renderPane={(p) => (
            <PlacementPane
              wsId={wsId}
              projectId={projectId}
              placement={p}
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
function AddChannelsModal({
  wsId,
  projectId,
  onClose,
}: {
  wsId: string;
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [bulkText, setBulkText] = useState("");
  const bulkLines = bulkText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
        {
          params: { path: { wsId, projectId } },
          body: { identifiers: bulkLines },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      // Не закрываем сразу — показываем итог (fix #9), особенно когда часть строк
      // пропущена. Чистый импорт без пропусков можно сразу закрыть.
    },
  });

  const res = add.data;

  return (
    <Modal onClose={onClose} size="lg">
      <h2 className="mb-1 text-base font-semibold">
        Добавить блогеров в лонглист
      </h2>
      {res ? (
        <div className="mt-3">
          <p className="text-sm text-zinc-700">
            Добавлено: <b>{res.added}</b>
            {res.channelsCreated > 0 && ` · создано каналов: ${res.channelsCreated}`}
            {res.skippedDuplicate > 0 && ` · уже были: ${res.skippedDuplicate}`}
            {res.skippedInvalid > 0 && ` · не распознано: ${res.skippedInvalid}`}
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Готово
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-xs text-zinc-500">
            По одной ссылке или @username на строку. Каналы сразу просканируются
            (подписчики, описание, личка) и сопоставятся с базой контактов.
            Рассылка не запускается — это отдельная кнопка «Запустить аутрич».
          </p>
          <textarea
            autoFocus
            rows={7}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={
              "По одной ссылке или @username на строку:\nhttps://t.me/durov\n@telegram\ndurov"
            }
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none"
          />
          {add.error && (
            <p className="mt-2 text-sm text-red-600">{errorMessage(add.error)}</p>
          )}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {bulkLines.length} блогеров
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={bulkLines.length === 0 || add.isPending}
                onClick={() => add.mutate()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Plus size={15} />
                {add.isPending ? "Добавляем…" : `Добавить (${bulkLines.length})`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

// Запустить аутрич (этап 16.8): доступно в draft, когда у всех каналов есть
// контакт (жёсткий гейт; бэк тоже проверяет и вернёт 400). Правим цепочку и
// активируем. Опенер один на админа; {{каналы}} → перечень его каналов.
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
  const [messages, setMessages] = useState<Message[]>(() =>
    campaign.messages.length > 0 ? campaign.messages : [newMessage()],
  );
  const chainDirty =
    JSON.stringify(messages) !== JSON.stringify(campaign.messages);
  const chainEmpty =
    messages.length === 0 || messages.every((m) => !m.text.trim());

  const launch = useMutation({
    mutationFn: async () => {
      if (chainDirty) {
        const { error } = await api.PATCH(
          "/v1/workspaces/{wsId}/projects/{projectId}",
          { params: { path: { wsId, projectId } }, body: { messages } },
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
        человеческом темпе. Один опенер на админа — если у него несколько
        каналов, перечислите их через{" "}
        <code className="rounded bg-zinc-100 px-1">{"{{каналы}}"}</code>.
      </p>
      <MessagesEditor value={messages} onChange={setMessages} />
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
          disabled={chainEmpty || launch.isPending}
          onClick={() => launch.mutate()}
          title={chainEmpty ? "Сначала задайте цепочку сообщений" : undefined}
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
          {p.unread > 0 && (
            <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
              {p.unread}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-zinc-400">
          {ch?.username ? `@${ch.username}` : "—"}
          {siblingCount > 0 && (
            <span className="text-zinc-400"> · ещё {siblingCount} у админа</span>
          )}
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
          <div className="text-xs text-zinc-500">
            В шортлисте {shortlist.length} · решений клиента {decided}/
            {shortlist.length}
          </div>
          <TableCard>
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <Th>Канал</Th>
                <Th className="text-right">Подписчики</Th>
                <Th className="text-right">Охват</Th>
                <Th className="text-right">ERR</Th>
                <Th className="text-right">Цена</Th>
                <Th className="text-right">Цена для клиента</Th>
                <Th>Решение клиента</Th>
                <Th>Комментарий</Th>
              </tr>
            </thead>
            <tbody>
              {shortlist.map((p) => {
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
                      {formatViews(p.channel?.avgReach ?? null)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {p.channel?.err != null ? p.channel.err + "%" : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {formatRub(p.priceAmount)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ClientPriceCell
                        wsId={wsId}
                        projectId={projectId}
                        placement={p}
                      />
                    </td>
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
          </TableCard>
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
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
    void navigator.clipboard.writeText(f);
    setCopied(f);
    setTimeout(() => setCopied((c) => (c === f ? null : c)), 1500);
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
              <ProductionPane wsId={wsId} projectId={projectId} placement={p} />
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

  const totalBudget = rows.reduce((s, p) => s + (p.priceAmount ?? 0), 0);
  // Средний CPV считаем по строкам с реально снятыми просмотрами: иначе бюджет
  // ещё-не-снятых попадёт в числитель при нуле в знаменателе → CPV завышается
  // в разы и «прыгает» вниз по мере добора метрик.
  const measured = rows.filter((p) => p.metricsViews !== null);
  const measuredViews = measured.reduce((s, p) => s + (p.metricsViews ?? 0), 0);
  const measuredBudget = measured.reduce((s, p) => s + (p.priceAmount ?? 0), 0);

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
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{
                    width: `${Math.round((completed / rows.length) * 100)}%`,
                  }}
                />
              </div>
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
            <Stat label="Σ просмотров" value={formatViews(measuredViews)} />
            <Stat label="Σ бюджет" value={formatRub(totalBudget)} />
            <Stat
              label="Средний CPV"
              value={
                measured.length > 0 ? cpv(measuredBudget, measuredViews) : "—"
              }
            />
          </div>

          <TableCard>
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <Th>Канал</Th>
                <Th>Пост</Th>
                <Th className="text-right">
                  <Eye size={13} className="inline" />
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
                <Th className="text-right">CPV</Th>
                <Th>Снято</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100">
                  <td className="px-4 py-2.5">
                    <ChannelCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <PostSnapshotCell placement={p} />
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
                    {cpv(p.priceAmount, p.metricsViews)}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
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
// Цена для клиента: по умолчанию «= [закупочная]» серым (клиент видит ту же
// сумму). Клик → инпут с оверрайдом; пусто → снова «совпадает» (clientPrice=null).
function ClientPriceCell({
  wsId,
  projectId,
  placement,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: async (val: number | null) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { clientPrice: val },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
    },
  });
  const commit = () => {
    const t = draft.replace(/\s/g, "");
    const val = t === "" ? null : Number(t);
    if (val !== null && !Number.isFinite(val)) return setEditing(false);
    if ((placement.clientPrice ?? null) === val) return setEditing(false);
    save.mutate(val);
  };
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        placeholder="как закупка"
        className="w-28 rounded-md border border-emerald-400 px-2 py-1 text-right text-sm focus:outline-none"
      />
    );
  }
  const hasOverride = placement.clientPrice != null;
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(
          hasOverride
            ? String(placement.clientPrice)
            : placement.priceAmount != null
              ? String(placement.priceAmount)
              : "",
        );
        setEditing(true);
      }}
      title="Цена для клиента — кликните, чтобы указать другую (по умолчанию совпадает с закупочной)"
      className={
        "rounded px-1.5 py-0.5 text-sm tabular-nums hover:bg-zinc-100 " +
        (hasOverride ? "font-medium text-zinc-900" : "text-zinc-400")
      }
    >
      {hasOverride
        ? formatRub(placement.clientPrice)
        : `= ${formatRub(placement.priceAmount)}`}
    </button>
  );
}

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
          <div className="truncate text-xs text-zinc-400">
            {ch?.username ? `@${ch.username}` : "—"}
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


import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Plus,
  Settings2,
  Send,
  Users,
  ChevronRight,
  Search,
  Check,
  CheckCheck,
  MessageCircleReply,
  Pause,
  Play,
  CheckCircle2,
  RefreshCw,
  Eye,
  Repeat2,
  Heart,
} from "lucide-react";
import { BackButton } from "../../../../../components/back-button";
import { Modal } from "../../../../../components/modal";
import {
  MessagesEditor,
  newMessage,
  type Message,
} from "../../../../../components/messages-editor";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import { useEventSourceEvent } from "../../../../../lib/hooks";
import { formatPastRelative } from "../../../../../lib/date-utils";
import {
  type PhaseKey,
  type Placement,
  type Campaign,
  formatRub,
  formatViews,
  cpv,
} from "./-shared";
import {
  Chip,
  PhaseStepper,
  availableView,
  clientView,
  contractView,
  creativeView,
} from "./-ui";
import { PlacementDrawer, ProductionDrawer } from "./-placement-drawer";
import { ChannelDrawer } from "../../../../../components/channel-drawer";

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
    <div className="min-h-full">
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3">
          <div className="flex items-center gap-3">
            <BackButton />
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                {clientName}
              </div>
              <h1 className="truncate text-lg font-semibold">{campaign.name}</h1>
            </div>
            <div className="ml-auto flex items-center gap-4 text-sm">
              <Meta label="Бюджет" value={formatRub(campaign.budgetAmount)} />
              <StatusControls wsId={wsId} campaign={campaign} />
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-6 pb-4 pt-2">
          <PhaseStepper current={phase} onPick={pickPhase} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-5">
        {phase === "briefing" && (
          <BriefPhase
            wsId={wsId}
            campaign={campaign}
            onNext={() => pickPhase("longlist")}
          />
        )}
        {phase === "longlist" && (
          <LonglistPhase
            wsId={wsId}
            campaign={campaign}
            onNext={() => pickPhase("review")}
          />
        )}
        {phase === "review" && (
          <ReviewPhase
            wsId={wsId}
            campaign={campaign}
            onNext={() => pickPhase("shortlist")}
          />
        )}
        {phase === "shortlist" && (
          <ShortlistPhase
            wsId={wsId}
            campaign={campaign}
            onNext={() => pickPhase("production")}
          />
        )}
        {phase === "production" && (
          <ProductionPhase
            wsId={wsId}
            campaign={campaign}
            onNext={() => pickPhase("wrapup")}
          />
        )}
        {phase === "wrapup" && <WrapupPhase wsId={wsId} campaign={campaign} />}
      </div>
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

function NextBar({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-4">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        {children}
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ── Фаза 1: Бриф ──────────────────────────────────────────────────────────
function BriefPhase({
  wsId,
  campaign,
  onNext,
}: {
  wsId: string;
  campaign: Campaign;
  onNext: () => void;
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
      <NextBar onClick={onNext}>К лонглисту</NextBar>
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

// ── Фаза 2: Лонглист + аутрич ──────────────────────────────────────────────
function LonglistPhase({
  wsId,
  campaign,
  onNext,
}: {
  wsId: string;
  campaign: Campaign;
  onNext: () => void;
}) {
  const qc = useQueryClient();
  const projectId = campaign.id;
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [chainOpen, setChainOpen] = useState(false);
  const accountsQ = useOutreachAccounts(wsId);

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

  const activate = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/activate",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] }),
  });

  const placements = placementsQ.data ?? [];
  const open = placements.find((p) => p.id === openId) ?? null;
  const replied = placements.filter((p) => p.chainStatus === "replied").length;
  const isDraft = campaign.status === "draft";
  const canLaunch =
    isDraft && campaign.messages.length > 0 && placements.length > 0;

  return (
    <div className="space-y-4">
      <Toolbar>
        <PrimaryBtn icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>
          Добавить блогера
        </PrimaryBtn>
        <GhostBtn icon={<Settings2 size={15} />} onClick={() => setChainOpen(true)}>
          Настроить цепочку ({campaign.messages.length})
        </GhostBtn>
        {isDraft ? (
          <GhostBtn
            icon={<Send size={15} />}
            disabled={!canLaunch || activate.isPending}
            onClick={() => activate.mutate()}
            title={
              canLaunch
                ? "Запустить массовый аутрич по лонглисту"
                : "Нужна непустая цепочка и хотя бы один блогер"
            }
          >
            Запустить рассылку
          </GhostBtn>
        ) : (
          <Chip tone="emerald">рассылка идёт</Chip>
        )}
        <div className="ml-auto text-xs text-zinc-500">
          {placements.length} в лонглисте · {replied} ответили
        </div>
      </Toolbar>

      {activate.error && (
        <p className="text-sm text-red-600">{errorMessage(activate.error)}</p>
      )}

      {placements.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Лонглист пуст. Добавьте блогеров кнопкой «Добавить блогера».
        </div>
      ) : (
        <TableCard>
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <Th>Канал</Th>
              <Th>Аутрич</Th>
              <Th>Аккаунт</Th>
              <Th>Готов?</Th>
              <Th className="text-right">Цена</Th>
              <Th className="text-right">Прогноз ПДП</Th>
              <Th className="text-right">ERR</Th>
              <Th className="text-right">CPV</Th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => {
              const av = availableView(p.available);
              return (
                <tr
                  key={p.id}
                  onClick={() => setOpenId(p.id)}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                >
                  <td className="px-4 py-2.5">
                    <ChannelCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <OutreachStatus p={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <AccountCell account={p.account} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone={av.tone}>{av.label}</Chip>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {formatRub(p.priceAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {formatViews(p.forecastViews)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.forecastErr !== null ? p.forecastErr + "%" : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {cpv(p.priceAmount, p.forecastViews)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableCard>
      )}

      <NextBar onClick={onNext}>Отправить клиенту на согласование</NextBar>

      {open && (
        <PlacementDrawer
          wsId={wsId}
          projectId={projectId}
          placement={open}
          onClose={() => setOpenId(null)}
        />
      )}
      {addOpen && (
        <AddChannelModal
          wsId={wsId}
          projectId={projectId}
          existing={placements}
          onClose={() => setAddOpen(false)}
        />
      )}
      {chainOpen && (
        <ChainModal
          wsId={wsId}
          projectId={projectId}
          initial={campaign.messages}
          onClose={() => setChainOpen(false)}
        />
      )}
    </div>
  );
}

// ── Фаза 3: Согласование клиентом ──────────────────────────────────────────
function ReviewPhase({
  wsId,
  campaign,
  onNext,
}: {
  wsId: string;
  campaign: Campaign;
  onNext: () => void;
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

  return (
    <div className="space-y-4">
      <ShareAccessBlock wsId={wsId} projectId={projectId} />

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
                <Th className="text-right">Прогноз ПДП</Th>
                <Th className="text-right">ERR</Th>
                <Th className="text-right">Цена</Th>
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
                      <ChannelCell placement={p} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {formatViews(p.forecastViews)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {p.forecastErr !== null ? p.forecastErr + "%" : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                      {formatRub(p.priceAmount)}
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

      <NextBar onClick={onNext}>К финальному офферу</NextBar>
    </div>
  );
}

// Блок выдачи magic-link: создать ссылку (без email), скопировать, отозвать.
function ShareAccessBlock({
  wsId,
  projectId,
}: {
  wsId: string;
  projectId: string;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);
  const sharesQ = useQuery({
    queryKey: ["shares", wsId, projectId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/shares",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/shares",
        { params: { path: { wsId, projectId } }, body: {} },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["shares", wsId, projectId] }),
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
      qc.invalidateQueries({ queryKey: ["shares", wsId, projectId] }),
  });

  const shares = sharesQ.data ?? [];
  const fullUrl = (url: string) => window.location.origin + url;
  const copy = (url: string) => {
    void navigator.clipboard.writeText(fullUrl(url));
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Доступ клиента</h2>
          <p className="text-xs text-zinc-500">
            Ссылка на шортлист без регистрации. Клиент видит каналы и прогнозы
            (без ваших цен) и проставляет «подходит / не подходит».
          </p>
        </div>
        <PrimaryBtn icon={<Plus size={15} />} onClick={() => create.mutate()}>
          Создать ссылку
        </PrimaryBtn>
      </div>

      {shares.length === 0 ? (
        <p className="text-sm text-zinc-500">Ссылок ещё нет.</p>
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
                {copied === s.url ? "Скопировано" : "Скопировать"}
              </button>
              <button
                type="button"
                onClick={() => revoke.mutate(s.id)}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-zinc-400 hover:text-red-600"
              >
                Отозвать
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Фаза 4: Финальный оффер (bulk-send по шортлисту) ────────────────────────
function ShortlistPhase({
  wsId,
  campaign,
  onNext,
}: {
  wsId: string;
  campaign: Campaign;
  onNext: () => void;
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

  // Получатель есть, если worker сможет адресовать (username/tg_user_id) —
  // тот же критерий, что у backend (поле hasRecipient).
  const withTg = approved.filter((p) => p.hasRecipient).length;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            Финальный оффер шортлисту
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
            disabled={withTg === 0 || send.isPending || !text.trim()}
            onClick={() => send.mutate()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send size={15} />
            {send.isPending ? "Ставим в очередь…" : `Отправить ${withTg} блогерам`}
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
              <Th>Финальный оффер</Th>
            </tr>
          </thead>
          <tbody>
            {approved.map((p) => (
              <tr key={p.id} className="border-t border-zinc-100">
                <td className="px-4 py-2.5">
                  <ChannelCell placement={p} />
                </td>
                <td className="px-4 py-2.5">
                  {p.finalOfferSentAt ? (
                    <Chip tone="emerald">отправлен</Chip>
                  ) : (
                    <span className="text-xs text-zinc-400">не отправлен</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}

      <NextBar onClick={onNext}>К производству</NextBar>
    </div>
  );
}

// ── Фаза 5: Производство (pipeline-матрица) ─────────────────────────────────
function ProductionPhase({
  wsId,
  campaign,
  onNext,
}: {
  wsId: string;
  campaign: Campaign;
  onNext: () => void;
}) {
  const projectId = campaign.id;
  const [openId, setOpenId] = useState<string | null>(null);
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
  const rows = (rowsQ.data ?? []).filter((p) => p.clientStatus === "approved");
  const open = rows.find((p) => p.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Нет одобренных размещений. Производство стартует после согласования
          клиентом.
        </div>
      ) : (
        <TableCard>
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
              const ct = contractView[p.contractStatus];
              const cr = creativeView[p.creativeStatus];
              return (
                <tr
                  key={p.id}
                  onClick={() => setOpenId(p.id)}
                  className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50"
                >
                  <td className="px-4 py-2.5">
                    <ChannelCell placement={p} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone={ct.tone}>{ct.label}</Chip>
                  </td>
                  <td className="px-4 py-2.5">
                    <Chip tone={cr.tone}>
                      {cr.label}
                      {p.creativeRound > 1 ? ` · v${p.creativeRound}` : ""}
                    </Chip>
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
        </TableCard>
      )}

      <NextBar onClick={onNext}>К отчёту</NextBar>

      {open && (
        <ProductionDrawer
          wsId={wsId}
          projectId={projectId}
          placement={open}
          onClose={() => setOpenId(null)}
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

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
          Нет вышедших постов. Отчёт собирается после публикации размещений
          (фаза «Производство» → ссылка на пост).
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
                  <Repeat2 size={13} className="inline" />
                </Th>
                <Th className="text-right">
                  <Heart size={13} className="inline" />
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
                    {p.metricsForwards ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-zinc-700">
                    {p.metricsReactions ?? "—"}
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
  return (
    <div className="flex items-start gap-2">
      {snap?.thumbB64 ? (
        <img
          src={`data:image/jpeg;base64,${snap.thumbB64}`}
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

// ── Модалка: добавить канал в лонглист ──────────────────────────────────────
function AddChannelModal({
  wsId,
  projectId,
  existing,
  onClose,
}: {
  wsId: string;
  projectId: string;
  existing: Placement[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"bulk" | "one">("bulk");
  const [q, setQ] = useState("");
  const [bulkText, setBulkText] = useState("");
  const channelsQ = useQuery({
    queryKey: ["channels", wsId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/channels", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
  });
  const add = useMutation({
    mutationFn: async (channelId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements",
        { params: { path: { wsId, projectId } }, body: { channelId } },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  });

  // Массовое: по одному URL/@username на строку → один запрос, бэк делает
  // find-or-create канала и заводит размещения. Результат показываем сводкой.
  const bulkLines = bulkText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const bulk = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
        { params: { path: { wsId, projectId } }, body: { identifiers: bulkLines } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setBulkText("");
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
    },
  });

  const existingIds = new Set(
    existing.map((p) => p.channel?.id).filter(Boolean),
  );
  const term = q.trim().toLowerCase();
  const list = (channelsQ.data ?? []).filter((c) => {
    if (existingIds.has(c.id)) return false;
    if (!term) return true;
    return (
      c.title.toLowerCase().includes(term) ||
      (c.username ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <Modal onClose={onClose} size="md">
      <h2 className="mb-3 text-base font-semibold">Добавить блогеров в лонглист</h2>
      <div className="mb-3 flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm">
        <TabBtn active={tab === "bulk"} onClick={() => setTab("bulk")}>
          Несколько
        </TabBtn>
        <TabBtn active={tab === "one"} onClick={() => setTab("one")}>
          Один
        </TabBtn>
      </div>

      {tab === "bulk" ? (
        <div className="space-y-3">
          <textarea
            autoFocus
            rows={8}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={"По одной ссылке или @username на строку:\nhttps://t.me/durov\n@telegram\ndurov"}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none"
          />
          {bulk.data && (
            <p className="text-sm text-emerald-700">
              Добавлено {bulk.data.added} · новых каналов{" "}
              {bulk.data.channelsCreated}
              {bulk.data.skippedDuplicate > 0 &&
                ` · уже в списке: ${bulk.data.skippedDuplicate}`}
              {bulk.data.skippedInvalid > 0 &&
                ` · не распознано: ${bulk.data.skippedInvalid}`}
            </p>
          )}
          {bulk.error && (
            <p className="text-sm text-red-600">{errorMessage(bulk.error)}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">
              {bulkLines.length} строк
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Готово
              </button>
              <button
                type="button"
                disabled={bulk.isPending || bulkLines.length === 0}
                onClick={() => bulk.mutate()}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulk.isPending ? "Добавляем…" : `Добавить ${bulkLines.length}`}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск по названию или @username"
              className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {list.length === 0 && (
              <p className="px-1 py-2 text-sm text-zinc-500">
                {channelsQ.isLoading ? "Загрузка…" : "Ничего не найдено."}
              </p>
            )}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={add.isPending}
                onClick={() => add.mutate(c.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 disabled:opacity-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
                  <Users size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-zinc-900">
                    {c.title}
                  </div>
                  <div className="truncate text-xs text-zinc-400">
                    {c.username ? `@${c.username}` : "—"}
                    {c.memberCount != null &&
                      ` · ${formatViews(c.memberCount)} подписчиков`}
                  </div>
                </div>
                <Plus size={15} className="shrink-0 text-emerald-600" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Готово
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 rounded-md px-3 py-1.5 font-medium transition-colors " +
        (active
          ? "bg-white text-zinc-900 shadow-sm"
          : "text-zinc-500 hover:text-zinc-700")
      }
    >
      {children}
    </button>
  );
}

// ── Модалка: настроить цепочку аутрича ──────────────────────────────────────
function ChainModal({
  wsId,
  projectId,
  initial,
  onClose,
}: {
  wsId: string;
  projectId: string;
  initial: Message[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [messages, setMessages] = useState<Message[]>(() =>
    initial.length > 0 ? initial : [newMessage()],
  );
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId } },
          body: { messages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", wsId, projectId] });
      onClose();
    },
  });

  return (
    <Modal onClose={onClose} size="lg">
      <h2 className="mb-1 text-base font-semibold">Цепочка аутрича по лонглисту</h2>
      <p className="mb-3 text-xs text-zinc-500">
        Первое сообщение + пинги. «Готов сотрудничать? По какой цене?». После
        запуска рассылки worker отправит их через ваши Telegram-аккаунты.
      </p>
      <MessagesEditor value={messages} onChange={setMessages} />
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
      {save.error && (
        <p className="mt-2 text-sm text-red-600">{errorMessage(save.error)}</p>
      )}
    </Modal>
  );
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

function AccountCell({ account }: { account: Placement["account"] }) {
  if (!account) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <div className="text-xs">
      <div className="font-medium text-zinc-700">{account.firstName ?? "—"}</div>
      {account.tgUsername && (
        <div className="text-zinc-400">@{account.tgUsername}</div>
      )}
    </div>
  );
}

// Клик по каналу открывает общий ChannelDrawer (лента постов, авто-синк
// статистики «открыл-актуализировалось», админы) — переиспользуем со страницы
// Каналов. stopPropagation, чтобы не сработал row-click (drawer размещения).
function ChannelCell({ placement }: { placement: Placement }) {
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
        <ChannelDrawer
          wsId={wsId}
          channelId={ch.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-2.5 shadow-sm">
      {children}
    </div>
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

function GhostBtn({
  icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      {icon}
      {children}
    </button>
  );
}

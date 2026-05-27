import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  MessageCircle,
  ListChecks,
  Trash2,
  FileText,
  Image as ImageIcon,
  Calendar,
  Hash,
  Eye,
  FileCheck,
  Copy,
  Check,
  Circle,
} from "lucide-react";
import { api } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { useEscapeKey } from "../../../../../lib/hooks";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import {
  LeadChatDrawer,
  LeadChatPanel,
} from "../../../../../components/lead-chat-drawer";
import { ChannelCard } from "../../../../../components/channel-card";
import { ContactPicker } from "../../../../../components/contact-picker";
import type { Channel } from "@repo/core";
import { type Placement, type ContractStatus, type CreativeStatus } from "./-shared";
import { Chip, contractView, creativeView } from "./-ui";

type Draft = {
  available: boolean | null;
  priceAmount: string;
  forecastViews: string;
  forecastErr: string;
};

function toDraft(p: Placement): Draft {
  return {
    available: p.available,
    priceAmount: p.priceAmount?.toString() ?? "",
    forecastViews: p.forecastViews?.toString() ?? "",
    forecastErr: p.forecastErr?.toString() ?? "",
  };
}

// null для пустой строки, иначе число.
const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// Рабочая панель размещения в лонглисте (этап 16.8): по центру — карточка
// канала (метрики, описание, лента постов), справа — морфящийся рельс. Есть
// контакт-админ → поля сделки + переписка; нет → резолвер контакта. Не модалка:
// родитель монтирует с key=placement.id, поэтому при выборе другого блогера
// инстанс пересоздаётся и draft переинициализируется сам.
export function PlacementPane({
  wsId,
  projectId,
  placement,
  onRemoved,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(wsId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(placement));
  const [changing, setChanging] = useState(false);
  const channelId = placement.channel?.id ?? null;

  const channelQ = useQuery({
    queryKey: ["channel", wsId, channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}",
        { params: { path: { wsId, id: channelId! } } },
      );
      if (error) throw error;
      return data;
    },
    enabled: !!channelId,
    staleTime: 5 * 60 * 1000,
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            available: draft.available,
            priceAmount: numOrNull(draft.priceAmount),
            forecastViews: numOrNull(draft.forecastViews),
            forecastErr: numOrNull(draft.forecastErr),
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
    },
  });

  // «В шортлист» — собранного блогера убираем из опроса (shortlisted_at=now).
  // Шлём и черновик (цена/прогнозы) одним PATCH: автосейв на blur не успевает
  // сработать при клике по кнопке внутри той же строки (этап 16.8 / fix #3).
  const shortlist = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            available: draft.available,
            priceAmount: numOrNull(draft.priceAmount),
            forecastViews: numOrNull(draft.forecastViews),
            forecastErr: numOrNull(draft.forecastErr),
            shortlisted: true,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      onRemoved();
    },
  });

  // Кнопка «Сохранить» — только при наличии изменений (CLAUDE.md §6).
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(placement));

  return (
    <div className="flex h-full">
      {/* Центр: карточка канала — метрики, описание, лента постов. */}
      <div className="min-w-0 flex-1 overflow-hidden border-r border-zinc-200">
        {channelQ.data ? (
          <ChannelCard wsId={wsId} channel={channelQ.data} />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
            {channelQ.isLoading ? "Загрузка канала…" : "Канал недоступен"}
          </div>
        )}
      </div>

      {/* Правый рельс (50/50 с каналом): сделка+переписка если есть контакт,
          иначе резолвер. */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {placement.adminContactId && !changing ? (
          <>
            <div
              onBlur={(e) => {
                // Сохраняем, только когда фокус ушёл со всей строки.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dirty && !save.isPending) save.mutate();
              }}
              className="border-b border-zinc-200 px-4 py-3"
            >
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <BarField label="Готов">
                  <select
                    value={
                      draft.available === null
                        ? ""
                        : draft.available
                          ? "yes"
                          : "no"
                    }
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        available:
                          e.target.value === ""
                            ? null
                            : e.target.value === "yes",
                      }))
                    }
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="">—</option>
                    <option value="yes">Да</option>
                    <option value="no">Нет</option>
                  </select>
                </BarField>
                <BarField label="Цена ₽">
                  <BarNum
                    value={draft.priceAmount}
                    onChange={(v) => setDraft((d) => ({ ...d, priceAmount: v }))}
                  />
                </BarField>
                <BarField label="Прогноз ПДП">
                  <BarNum
                    value={draft.forecastViews}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, forecastViews: v }))
                    }
                  />
                </BarField>
                <BarField label="ERR %">
                  <BarNum
                    value={draft.forecastErr}
                    onChange={(v) => setDraft((d) => ({ ...d, forecastErr: v }))}
                  />
                </BarField>
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => shortlist.mutate()}
                  disabled={shortlist.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <ListChecks size={15} />
                  {shortlist.isPending ? "…" : "В шортлист"}
                </button>
                <SaveHint pending={save.isPending} error={save.error} />
                <RemovePlacementButton
                  wsId={wsId}
                  projectId={projectId}
                  placementId={placement.id}
                  onRemoved={onRemoved}
                  className="ml-auto"
                />
              </div>
            </div>
            <ContactHeader
              placement={placement}
              onChange={() => setChanging(true)}
            />
            <div className="min-h-0 flex-1">
              <LeadChatPanel
                wsId={wsId}
                lead={{
                  id: placement.id,
                  contactId: placement.adminContactId,
                  account: null,
                }}
                accounts={accountsQ.data ?? []}
              />
            </div>
          </>
        ) : (
          <Resolver
            wsId={wsId}
            projectId={projectId}
            placement={placement}
            channel={channelQ.data ?? null}
            onRemoved={onRemoved}
            onClose={
              placement.adminContactId ? () => setChanging(false) : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

// Кнопка «убрать канал из лонглиста» — общая для строки сделки (иконка) и
// резолвера (текстом). Удаляет размещение, переключает список на следующего.
function RemovePlacementButton({
  wsId,
  projectId,
  placementId,
  onRemoved,
  className = "",
  text,
}: {
  wsId: string;
  projectId: string;
  placementId: string;
  onRemoved: () => void;
  className?: string;
  text?: boolean;
}) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        { params: { path: { wsId, projectId, placementId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      onRemoved();
    },
  });
  const onClick = () => {
    if (window.confirm("Убрать этот канал из лонглиста?")) remove.mutate();
  };
  if (text) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={remove.isPending}
        className={
          "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 " +
          className
        }
      >
        <Trash2 size={15} />
        Убрать канал из лонглиста
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={remove.isPending}
      title="Убрать из лонглиста"
      className={
        "rounded-lg border border-zinc-300 p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 " +
        className
      }
    >
      <Trash2 size={15} />
    </button>
  );
}

// Шапка контакта над перепиской: кто привязан + «сменить» (этап 16.8 / п.1).
function ContactHeader({
  placement,
  onChange,
}: {
  placement: Placement;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-1.5 text-xs">
      <span className="min-w-0 truncate text-zinc-500">
        Контакт:{" "}
        {placement.adminUsername ? `@${placement.adminUsername}` : "привязан"}
      </span>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 font-medium text-emerald-700 hover:text-emerald-800"
      >
        сменить
      </button>
    </div>
  );
}

// Резолвер / смена способа связи (этап 16.8): правый рельс для канала без
// контакта, либо режим «сменить» (onClose задан → есть «← к переписке»).
// Суджест-чипы @ из описания, поиск/создание контакта, «в личку (0⭐)»,
// «убрать канал». Любой выбор идёт через set-admin — глобально по каналу.
function Resolver({
  wsId,
  projectId,
  placement,
  channel,
  onRemoved,
  onClose,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  channel: Channel | null;
  onRemoved: () => void;
  onClose?: () => void;
}) {
  const qc = useQueryClient();
  const channelId = placement.channel?.id ?? null;

  const setAdmin = useMutation({
    mutationFn: async (body: {
      contactId?: string;
      username?: string;
      dm?: boolean;
    }) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/set-admin",
        { params: { path: { wsId, id: channelId! } }, body },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel", wsId, channelId] });
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      onClose?.();
    },
  });

  const suggestions = useMemo(
    () => extractHandles(channel?.description ?? "", channel?.username ?? null),
    [channel?.description, channel?.username],
  );

  const meta = (channel?.meta ?? {}) as Record<string, unknown>;
  // Личка канала по direct_messages_chat_id (синкается на скане), не по has_dm
  // (его пишет репликатор асинхронно). Стоимость null = ещё не синкали → не
  // утверждаем «бесплатно».
  const dmChatId = meta.direct_messages_chat_id;
  const hasDmGroup = dmChatId != null && String(dmChatId) !== "0";
  const dmStar =
    typeof meta.outgoing_paid_message_star_count === "number"
      ? meta.outgoing_paid_message_star_count
      : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-4 py-3">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="mb-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            ← к переписке
          </button>
        )}
        <div className="text-sm font-semibold text-zinc-900">
          {onClose ? "Сменить контакт" : "Контакт админа"}
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          Кого слушаем по этому каналу. Меняется глобально — у канала во всех
          кампаниях.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {hasDmGroup && dmStar === 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <p>У канала открыта личка — писать можно бесплатно.</p>
            <button
              type="button"
              onClick={() => setAdmin.mutate({ dm: true })}
              disabled={setAdmin.isPending}
              className="mt-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Использовать личку канала
            </button>
          </div>
        )}
        {hasDmGroup && dmStar !== null && dmStar > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            В личку канала: {dmStar}⭐ за сообщение. Авторассылка сюда не идёт —
            напишите вручную или найдите контакт админа.
          </div>
        )}

        {suggestions.length > 0 && (
          <div>
            <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              Возможные контакты из описания
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setAdmin.mutate({ username: h })}
                  disabled={setAdmin.isPending}
                  title="Назначить админом канала"
                  className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                >
                  + @{h}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {onClose ? "Другой контакт" : "Привязать контакт"}
          </div>
          <ContactPicker
            wsId={wsId}
            excludeIds={new Set()}
            onPick={(contactId) => setAdmin.mutate({ contactId })}
            onCreateByUsername={(username) => setAdmin.mutate({ username })}
            loading={setAdmin.isPending}
          />
        </div>

        {setAdmin.error && (
          <p className="text-xs text-red-600">{errorMessage(setAdmin.error)}</p>
        )}
      </div>

      <div className="border-t border-zinc-200 px-4 py-3">
        <RemovePlacementButton
          wsId={wsId}
          projectId={projectId}
          placementId={placement.id}
          onRemoved={onRemoved}
          className="w-full"
          text
        />
      </div>
    </div>
  );
}

// Кандидаты-контакты из текста (описание канала): @username и t.me/username.
// Только суджест — менеджер подтверждает кликом, молча в channel_admins не
// пишем (ложные срабатывания: партнёрские каналы, упоминания).
// Служебные пути t.me — это не username'ы (joinchat/addstickers/proxy/…), их в
// кандидаты не берём, иначе клик создаёт мусорный контакт (fix #8).
const RESERVED_TME_PATHS = new Set([
  "joinchat",
  "addstickers",
  "addemoji",
  "addtheme",
  "proxy",
  "socks",
  "share",
  "setlanguage",
  "confirmphone",
  "login",
  "contact",
  "iv",
  "bg",
]);

function extractHandles(text: string, ownUsername: string | null): string[] {
  const own = ownUsername?.toLowerCase() ?? null;
  const out = new Set<string>();
  const re = /(?:@|t\.me\/|telegram\.me\/)([a-zA-Z0-9_]{4,32})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const h = m[1]!.toLowerCase();
    if (h === own) continue;
    if (h.endsWith("bot")) continue; // боты — не личные контакты админа
    if (RESERVED_TME_PATHS.has(h)) continue; // служебные ссылки t.me
    out.add(h);
  }
  return [...out].slice(0, 8);
}

function BarField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function BarNum({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      inputMode="numeric"
      value={value}
      placeholder="—"
      onChange={(e) => onChange(e.target.value)}
      className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
    />
  );
}

function SaveHint({ pending, error }: { pending: boolean; error: unknown }) {
  if (pending) return <span className="text-xs text-zinc-400">Сохраняем…</span>;
  if (error)
    return <span className="text-xs text-red-600">{errorMessage(error)}</span>;
  return null;
}

// ── Drawer производства (фаза 5): vertical pipeline-stepper ─────────────────
type ProdDraft = {
  contractStatus: ContractStatus;
  creativeStatus: CreativeStatus;
  creativeRound: number;
  scheduledDate: string; // YYYY-MM-DD
  erid: string;
  eridAdvertiserData: string;
  postUrl: string;
  published: boolean;
  actReceived: boolean;
};

function toProd(p: Placement): ProdDraft {
  return {
    contractStatus: p.contractStatus,
    creativeStatus: p.creativeStatus,
    creativeRound: p.creativeRound,
    scheduledDate: p.scheduledAt ? p.scheduledAt.slice(0, 10) : "",
    erid: p.erid ?? "",
    eridAdvertiserData: p.eridAdvertiserData ?? "",
    postUrl: p.postUrl ?? "",
    published: !!p.publishedAt,
    actReceived: !!p.actReceivedAt,
  };
}

export function ProductionDrawer({
  wsId,
  projectId,
  placement,
  onClose,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  onClose: () => void;
}) {
  useEscapeKey(onClose);
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(wsId);
  const [chatOpen, setChatOpen] = useState(false);
  const [draft, setDraft] = useState<ProdDraft>(() => toProd(placement));
  const set = <K extends keyof ProdDraft>(k: K, v: ProdDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            contractStatus: draft.contractStatus,
            creativeStatus: draft.creativeStatus,
            creativeRound: draft.creativeRound,
            scheduledAt: draft.scheduledDate
              ? new Date(draft.scheduledDate).toISOString()
              : null,
            erid: draft.erid || null,
            eridAdvertiserData: draft.eridAdvertiserData || null,
            postUrl: draft.postUrl || null,
            publishedAt: draft.published
              ? (placement.publishedAt ?? new Date().toISOString())
              : null,
            actReceivedAt: draft.actReceived
              ? (placement.actReceivedAt ?? new Date().toISOString())
              : null,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(toProd(placement));
  const ct = contractView[draft.contractStatus];
  const cr = creativeView[draft.creativeStatus];
  const copyErid = () => {
    void navigator.clipboard.writeText(
      `erid: ${draft.erid} · Реклама: ${draft.eridAdvertiserData}`,
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-zinc-900">
              {placement.channel?.title ?? "Канал удалён"}
            </div>
            <div className="text-xs text-zinc-500">
              {placement.channel?.username
                ? `@${placement.channel.username}`
                : "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <StepCard
            icon={<FileText size={16} />}
            title="Договор"
            done={draft.contractStatus === "signed"}
            status={<Chip tone={ct.tone}>{ct.label}</Chip>}
          >
            <ProdSelect
              value={draft.contractStatus}
              onChange={(v) => set("contractStatus", v as ContractStatus)}
              options={[
                ["none", "не отправлен"],
                ["sent", "отправлен"],
                ["revising", "правки"],
                ["signed", "подписан"],
              ]}
            />
          </StepCard>

          <StepCard
            icon={<ImageIcon size={16} />}
            title={
              draft.creativeRound > 0
                ? `Креатив · раунд ${draft.creativeRound}`
                : "Креатив"
            }
            done={draft.creativeStatus === "approved"}
            status={<Chip tone={cr.tone}>{cr.label}</Chip>}
          >
            <div className="flex items-center gap-2">
              <ProdSelect
                value={draft.creativeStatus}
                onChange={(v) => set("creativeStatus", v as CreativeStatus)}
                options={[
                  ["none", "—"],
                  ["awaiting", "ждём драфт"],
                  ["internal_review", "проверка агентством"],
                  ["client_review", "у клиента на ОК"],
                  ["revising", "правки"],
                  ["approved", "одобрен"],
                ]}
              />
              <input
                type="number"
                min={0}
                value={draft.creativeRound}
                onChange={(e) => set("creativeRound", Number(e.target.value))}
                title="Раунд правок"
                className="w-16 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </StepCard>

          <StepCard
            icon={<Calendar size={16} />}
            title="Дата выхода"
            done={!!draft.scheduledDate}
            status={
              draft.scheduledDate ? (
                <Chip tone="emerald">{draft.scheduledDate}</Chip>
              ) : (
                <Chip tone="zinc">не назначена</Chip>
              )
            }
          >
            <input
              type="date"
              value={draft.scheduledDate}
              onChange={(e) => set("scheduledDate", e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </StepCard>

          <StepCard
            icon={<Hash size={16} />}
            title="ЕРИД"
            done={!!draft.erid}
            status={
              draft.erid ? (
                <Chip tone="emerald">есть</Chip>
              ) : (
                <Chip tone="zinc">нет</Chip>
              )
            }
          >
            <div className="space-y-2">
              <input
                value={draft.erid}
                onChange={(e) => set("erid", e.target.value)}
                placeholder="erid токен"
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <input
                value={draft.eridAdvertiserData}
                onChange={(e) => set("eridAdvertiserData", e.target.value)}
                placeholder="данные рекла (ИНН + название)"
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              {draft.erid && (
                <ProdGhostBtn onClick={copyErid}>
                  <Copy size={13} /> Скопировать для блогера
                </ProdGhostBtn>
              )}
              <p className="text-[11px] text-zinc-400">
                MVP: проставляем руками, реплаем отвечаем в чате. Авто-запрос ЕРИД
                — позже.
              </p>
            </div>
          </StepCard>

          <StepCard
            icon={<Eye size={16} />}
            title="Публикация"
            done={draft.published}
            status={
              draft.published ? (
                <Chip tone="emerald">вышел</Chip>
              ) : (
                <Chip tone="zinc">не вышел</Chip>
              )
            }
          >
            <div className="space-y-2">
              <input
                value={draft.postUrl}
                onChange={(e) => set("postUrl", e.target.value)}
                placeholder="https://t.me/channel/123"
                className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(e) => set("published", e.target.checked)}
                />
                Пост вышел
              </label>
            </div>
          </StepCard>

          <StepCard
            icon={<FileCheck size={16} />}
            title="Акт"
            done={draft.actReceived}
            status={
              draft.actReceived ? (
                <Chip tone="emerald">получен</Chip>
              ) : (
                <Chip tone="zinc">нет</Chip>
              )
            }
          >
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={draft.actReceived}
                onChange={(e) => set("actReceived", e.target.checked)}
              />
              Акт получен от блогера
            </label>
          </StepCard>

          {placement.adminContactId && (
            <ProdGhostBtn onClick={() => setChatOpen(true)}>
              <MessageCircle size={14} /> Переписка с админом
            </ProdGhostBtn>
          )}
        </div>

        <div className="border-t border-zinc-200 p-3">
          {dirty ? (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {save.isPending ? "Сохраняем…" : "Сохранить"}
            </button>
          ) : (
            <p className="text-center text-xs text-zinc-400">
              Платим блогеру: {placement.priceAmount?.toLocaleString("ru-RU") ?? "—"} ₽
            </p>
          )}
          {save.error && (
            <p className="mt-2 text-sm text-red-600">
              {errorMessage(save.error)}
            </p>
          )}
        </div>
      </div>

      {chatOpen && placement.adminContactId && (
        <LeadChatDrawer
          wsId={wsId}
          lead={{
            id: placement.id,
            contactId: placement.adminContactId,
            account: null,
          }}
          accounts={accountsQ.data ?? []}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

function StepCard({
  icon,
  title,
  done,
  status,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  done: boolean;
  status: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={
            "flex h-6 w-6 items-center justify-center rounded-full " +
            (done
              ? "bg-emerald-100 text-emerald-700"
              : "bg-zinc-100 text-zinc-400")
          }
        >
          {done ? <Check size={14} /> : <Circle size={10} />}
        </span>
        <span className="flex items-center gap-1.5 text-sm font-medium text-zinc-800">
          {icon}
          {title}
        </span>
        <span className="ml-auto">{status}</span>
      </div>
      <div className="pl-8">{children}</div>
    </div>
  );
}

function ProdSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

function ProdGhostBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
    >
      {children}
    </button>
  );
}

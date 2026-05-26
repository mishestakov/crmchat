import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { LeadChatDrawer } from "../../../../../components/lead-chat-drawer";
import { type Placement, type ContractStatus, type CreativeStatus } from "./-shared";
import { Chip, contractView, creativeView } from "./-ui";

// Drawer размещения в лонглисте: данные подбора (готов/цена/прогнозы —
// заполняются менеджером руками по ответу блогера) + вход в переписку с
// админом канала. Чат переиспользует LeadChatDrawer (по contactId админа).

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

export function PlacementDrawer({
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
  const [draft, setDraft] = useState<Draft>(() => toDraft(placement));
  const [chatOpen, setChatOpen] = useState(false);

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

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });

  // «В шортлист» — собранного блогера убираем из опроса (shortlisted_at=now),
  // он уходит на фазу согласования. Закрываем drawer — строка выбывает.
  const shortlist = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { shortlisted: true },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        { params: { path: { wsId, projectId, placementId: placement.id } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  // Кнопка «Сохранить» — только при наличии изменений (CLAUDE.md §6).
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(placement));

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative flex h-full w-full max-w-[440px] flex-col bg-white shadow-2xl">
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

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Данные подбора
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Готов сотрудничать">
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
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">—</option>
                  <option value="yes">Да</option>
                  <option value="no">Нет</option>
                </select>
              </Field>
              <Field label="Цена за пост, ₽">
                <NumInput
                  value={draft.priceAmount}
                  onChange={(v) => setDraft((d) => ({ ...d, priceAmount: v }))}
                />
              </Field>
              <Field label="Прогноз ПДП">
                <NumInput
                  value={draft.forecastViews}
                  onChange={(v) => setDraft((d) => ({ ...d, forecastViews: v }))}
                />
              </Field>
              <Field label="Прогноз ERR, %">
                <NumInput
                  value={draft.forecastErr}
                  onChange={(v) => setDraft((d) => ({ ...d, forecastErr: v }))}
                />
              </Field>
            </div>
            {dirty && (
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {save.isPending ? "Сохраняем…" : "Сохранить"}
              </button>
            )}
            {save.error && (
              <p className="mt-2 text-sm text-red-600">
                {errorMessage(save.error)}
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Коммуникация
            </div>
            {placement.adminContactId ? (
              <button
                type="button"
                onClick={() => setChatOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                <MessageCircle size={15} />
                Переписка с админом
                {placement.adminUsername && (
                  <span className="text-zinc-400">
                    @{placement.adminUsername}
                  </span>
                )}
              </button>
            ) : (
              <p className="text-sm text-zinc-500">
                У канала нет контакта-админа — аутрич по нему недоступен, пока не
                привязан контакт.
              </p>
            )}
          </div>

          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <button
              type="button"
              onClick={() => shortlist.mutate()}
              disabled={shortlist.isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <ListChecks size={15} />
              {shortlist.isPending ? "Добавляем…" : "Добавить в шортлист"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Убрать этот канал из лонглиста?")) {
                  remove.mutate();
                }
              }}
              disabled={remove.isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 size={15} />
              Удалить из лонглиста
            </button>
            {(shortlist.error || remove.error) && (
              <p className="text-sm text-red-600">
                {errorMessage(shortlist.error ?? remove.error)}
              </p>
            )}
          </div>
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

function NumInput({
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
      className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
    />
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
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

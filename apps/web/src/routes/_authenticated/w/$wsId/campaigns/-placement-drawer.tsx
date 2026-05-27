import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  MessageCircle,
  Send,
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
import {
  formatViews,
  type Placement,
  type ContractStatus,
  type CreativeStatus,
} from "./-shared";
import { Chip, contractView, creativeView } from "./-ui";

// Менеджер вводит руками только цену — прогнозы (охват/ERR) берём из канала
// (этап 16.10), «готов» заменён кнопками решения.
type Draft = { priceAmount: string };

function toDraft(p: Placement): Draft {
  return { priceAmount: p.priceAmount?.toString() ?? "" };
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

  // Авто-метрики канала из ленты (этап 16.10): показываем read-only и
  // снапшотим в прогноз при «Согласован» — менеджер их не вводит.
  const cMeta = (channelQ.data?.meta ?? {}) as Record<string, unknown>;
  const avgReach = typeof cMeta.avg_reach === "number" ? cMeta.avg_reach : null;
  const cErr = typeof cMeta.err === "number" ? cMeta.err : null;
  // Бот — ручной способ связи (этап 16.9): авто-цепочка его пропускает.
  // Авторитетно из tg_users.is_bot (userTypeBot), НЕ суффикс @…bot (резал живых
  // @talbot/@robot).
  const isBot = placement.adminIsBot;
  // Способ связи канала (этап 16.9): человек/бот (adminContactId) ИЛИ
  // группа/личка-канала (meta.contact_method). null → способ ещё не выбран.
  const contactMethod = (cMeta.contact_method ?? null) as {
    kind?: string;
  } | null;
  const methodKind = placement.adminContactId
    ? "person"
    : (contactMethod?.kind ?? null);
  const hasMethod = methodKind !== null;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });

  // Автосейв цены на blur (единственное ручное поле).
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { priceAmount: numOrNull(draft.priceAmount) },
        },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // «Согласован» — блогер согласился: цена + снапшот метрик канала в прогноз →
  // в шортлист (этап 16.10). onRemoved переключит список на следующего.
  const agree = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            available: true,
            priceAmount: numOrNull(draft.priceAmount),
            forecastViews: avgReach,
            forecastErr: cErr,
            shortlisted: true,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      onRemoved();
    },
  });

  // «Отказ» — не работаем: available=false (строка прячется из списка, A4).
  const decline = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { available: false },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
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
          <ChannelCard wsId={wsId} channel={channelQ.data} compact />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
            {channelQ.isLoading ? "Загрузка канала…" : "Канал недоступен"}
          </div>
        )}
      </div>

      {/* Правый рельс (50/50): сделка + переписка/чат-по-способу, если способ
          связи выбран (человек/бот/группа/личка), иначе резолвер. */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {hasMethod && !changing ? (
          <>
            <div
              onBlur={(e) => {
                // Сохраняем, только когда фокус ушёл со всей строки.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dirty && !save.isPending) save.mutate();
              }}
              className="border-b border-zinc-200 px-4 py-3"
            >
              {isBot && (
                <div className="mb-2 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">
                  Бот — авторассылка сюда не идёт, напишите вручную в чате ниже.
                </div>
              )}
              {(avgReach !== null || cErr !== null) && (
                <div className="mb-2 flex items-baseline gap-4 text-xs text-zinc-500">
                  {avgReach !== null && (
                    <span>
                      ср. охват{" "}
                      <b className="text-zinc-700">{formatViews(avgReach)}</b>
                    </span>
                  )}
                  {cErr !== null && (
                    <span>
                      ERR <b className="text-zinc-700">{cErr}%</b>
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-end gap-3">
                <BarField label="Цена ₽">
                  <BarNum
                    value={draft.priceAmount}
                    onChange={(v) => setDraft({ priceAmount: v })}
                  />
                </BarField>
                <SaveHint pending={save.isPending} error={save.error} />
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => agree.mutate()}
                  disabled={agree.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  title="Блогер согласился — в шортлист"
                >
                  <Check size={15} />
                  Согласован
                </button>
                <button
                  type="button"
                  onClick={() => decline.mutate()}
                  disabled={decline.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  title="Не работаем — скрыть из списка"
                >
                  <X size={15} />
                  Отказ
                </button>
                <RemovePlacementButton
                  wsId={wsId}
                  projectId={projectId}
                  placementId={placement.id}
                  onRemoved={onRemoved}
                  className="ml-auto"
                />
              </div>
            </div>
            {placement.adminContactId ? (
              <>
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
              <>
                <MethodHeader
                  label={
                    methodKind === "group" ? "Группа обсуждения" : "Личка канала"
                  }
                  onChange={() => setChanging(true)}
                />
                {methodKind === "group" && placement.channel ? (
                  <div className="min-h-0 flex-1">
                    <GroupChatPanel
                      wsId={wsId}
                      channelId={placement.channel.id}
                    />
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-zinc-400">
                    Личка канала — пишите в Telegram (чат в приложении добавим
                    позже).
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <Resolver
            wsId={wsId}
            projectId={projectId}
            placement={placement}
            channel={channelQ.data ?? null}
            onRemoved={onRemoved}
            onClose={hasMethod ? () => setChanging(false) : undefined}
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

// Шапка способа связи группа/личка (этап 16.9): что выбрано + «сменить».
function MethodHeader({
  label,
  onChange,
}: {
  label: string;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-1.5 text-xs">
      <span className="min-w-0 truncate text-zinc-500">Способ связи: {label}</span>
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
      group?: { chatId: string; accountId: string };
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
        {/* Личка канала — всегда видна с ценой (этап 16.9). Бесплатно → авто;
            платно → вручную. Неизвестна (не синкали) → сначала открой ленту. */}
        {hasDmGroup && (
          <div
            className={
              "rounded-lg border px-3 py-2 text-xs " +
              (dmStar === 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800")
            }
          >
            <p>
              {dmStar === 0
                ? "У канала открыта личка — писать можно бесплатно."
                : dmStar !== null
                  ? `В личку канала: ${dmStar}⭐ за сообщение (авторассылка не идёт, вручную).`
                  : "У канала есть личка — стоимость уточняется (откройте ленту канала)."}
            </p>
            {dmStar !== null && (
              <button
                type="button"
                onClick={() => setAdmin.mutate({ dm: true })}
                disabled={setAdmin.isPending}
                className={
                  "mt-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50 " +
                  (dmStar === 0
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-amber-600 hover:bg-amber-700")
                }
              >
                {dmStar === 0
                  ? "Использовать личку канала"
                  : "Использовать личку (вручную)"}
              </button>
            )}
          </div>
        )}

        {/* Группа аккаунта (этап 16.9): из диалогов подключённых аккаунтов. */}
        <div>
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            Группа аккаунта
          </div>
          <GroupPicker
            wsId={wsId}
            loading={setAdmin.isPending}
            onPick={(chatId, accountId) =>
              setAdmin.mutate({ group: { chatId, accountId } })
            }
          />
        </div>

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

// Чат группы (этап 16.9, G3): история с отправителями + отправка через
// аккаунт-участника. В отличие от 1:1-переписки — видно, кто из участников
// пишет (senderName на входящих).
function GroupChatPanel({
  wsId,
  channelId,
}: {
  wsId: string;
  channelId: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const historyQ = useQuery({
    queryKey: ["group-history", wsId, channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/group-history",
        { params: { path: { wsId, id: channelId }, query: { limit: 50 } } },
      );
      if (error) throw error;
      return data.messages;
    },
    staleTime: 60 * 1000,
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/group-send",
        { params: { path: { wsId, id: channelId } }, body: { text: text.trim() } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["group-history", wsId, channelId] });
    },
  });
  // TDLib отдаёт newest-first → разворачиваем в oldest-first для рендера.
  const ordered = [...(historyQ.data ?? [])].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-zinc-50 px-3 py-3">
        {historyQ.isLoading ? (
          <p className="text-center text-sm text-zinc-400">Загрузка…</p>
        ) : historyQ.error ? (
          <div className="px-2 py-4 text-center text-sm text-red-600">
            <p>Группа недоступна через привязанный аккаунт.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Возможно, аккаунт вышел из группы — перепривяжите группу или
              выберите другой способ связи.
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {errorMessage(historyQ.error)}
            </p>
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-center text-sm text-zinc-400">Сообщений нет</p>
        ) : (
          ordered.map((m) => (
            <div
              key={m.id}
              className={"flex " + (m.isOutgoing ? "justify-end" : "justify-start")}
            >
              <div
                className={
                  "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm " +
                  (m.isOutgoing
                    ? "bg-emerald-100 text-zinc-900"
                    : "bg-white ring-1 ring-zinc-200")
                }
              >
                {!m.isOutgoing && (
                  <div className="text-[11px] font-medium text-emerald-700">
                    {m.senderName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                <div className="mt-0.5 text-right text-[10px] text-zinc-400">
                  {new Date(m.date).toLocaleString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-zinc-200 p-2">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Сообщение в группу…"
          className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={!text.trim() || send.isPending}
          className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
      {send.error && (
        <p className="px-2 pb-1 text-xs text-red-600">
          {errorMessage(send.error)}
        </p>
      )}
    </div>
  );
}

// Пикер групп аккаунта (этап 16.9): поиск по группам, в которых состоят
// аккаунты воркспейса (tg_groups). Выбор → привязка группы как способа связи;
// account_id нужен, чтобы потом читать/писать через аккаунт-участника (G3).
function GroupPicker({
  wsId,
  onPick,
  loading,
}: {
  wsId: string;
  onPick: (chatId: string, accountId: string) => void;
  loading: boolean;
}) {
  // Поиск групп БЕЗОПАСЕН для MTProto, поэтому RAM-кэш всех групп не нужен (нечем
  // флудить). Почему (ресерч по исходникам TDLib, tools/tdlib/.src):
  //   • /account-groups зовёт searchChats + getChat;
  //   • searchChats → MessagesManager::search_dialogs (MessagesManager.cpp:14146)
  //     ищет по in-memory `dialogs_hints_` и резолвит promise синхронно —
  //     td_api.tl прямо: «This is an offline method». Ноль сетевых запросов;
  //   • getChat для юзер-аккаунта — тоже offline (td_api.tl §getChat);
  //   • единственный сетевой вызов — loadChats, и его делает реплитор ОДИН раз
  //     на bootstrap, не на поиск (searchChatsOnServer мы не используем).
  // Дебаунс 500мс — лишь чтобы не гонять offline-поиск + IPC к воркеру на каждую
  // букву (латентность), не ради защиты от флуда.
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 500);
    return () => clearTimeout(t);
  }, [q]);
  const groupsQ = useQuery({
    queryKey: ["account-groups", wsId, debounced] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/account-groups",
        { params: { path: { wsId }, query: { q: debounced || undefined } } },
      );
      if (error) throw error;
      return data;
    },
  });
  const groups = groupsQ.data ?? [];
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/40 p-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск группы аккаунта"
        className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
      />
      {groups.length === 0 ? (
        <p className="mt-1.5 text-xs text-zinc-500">
          {groupsQ.isLoading
            ? "Загрузка…"
            : "Группы не найдены — подтянутся по мере репликации аккаунта."}
        </p>
      ) : (
        <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
          {groups.map((g) => (
            <li key={g.chatId}>
              <button
                type="button"
                onClick={() => onPick(g.chatId, g.accountId)}
                disabled={loading}
                className="w-full truncate rounded-md bg-white px-2 py-1.5 text-left text-sm hover:bg-emerald-100 disabled:opacity-50"
              >
                {g.title ?? "Без названия"}
              </button>
            </li>
          ))}
        </ul>
      )}
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
    if (RESERVED_TME_PATHS.has(h)) continue; // служебные ссылки t.me
    // Боты (@…bot) теперь валидный способ связи (ручной, этап 16.9) — предлагаем.
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

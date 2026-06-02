import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Send,
  Trash2,
  FileText,
  Image as ImageIcon,
  Hash,
  Eye,
  FileCheck,
  Check,
} from "lucide-react";
import { api, sendContactDocument } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { formatPastRelative } from "../../../../../lib/date-utils";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import { LeadChatPanel } from "../../../../../components/lead-chat-drawer";
import { MethodChatPanel } from "../../../../../components/method-chat-panel";
import { channelDm } from "../../../../../lib/channel-dm";
import {
  MESSAGE_TAG_LABEL,
  type MessageTagKind,
  type MessageTagRef,
} from "../../../../../components/chat-drawer";
import {
  FullResMedia,
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  renderMessageEntities,
} from "../../../../../lib/tg-message";
import { ChannelCard } from "../../../../../components/channel-card";
import { ContactPicker } from "../../../../../components/contact-picker";
import type { Channel } from "@repo/core";
import {
  formatViews,
  type Placement,
  type ContractStatus,
  type CreativeStatus,
} from "./-shared";
import { deriveProduction, PROD_OWNER } from "./-ui";

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
                {placement.channel ? (
                  <div className="min-h-0 flex-1">
                    <MethodChatPanel
                      wsId={wsId}
                      channelId={placement.channel.id}
                      target={methodKind === "group" ? "group" : "dm"}
                      starCost={placement.channel.dmStarCost}
                    />
                  </div>
                ) : null}
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
}: {
  wsId: string;
  projectId: string;
  placementId: string;
  onRemoved: () => void;
  className?: string;
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

  // Личка канала по direct_messages_chat_id (синкается на скане), не по has_dm.
  // Стоимость null = ещё не синкали → не утверждаем «бесплатно».
  const { hasDm: hasDmGroup, starCost: dmStar } = channelDm(channel?.meta);

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
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-900">
              {onClose ? "Сменить контакт" : "Контакт админа"}
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Кого слушаем по этому каналу. Меняется глобально — у канала во всех
              кампаниях.
            </p>
          </div>
          {/* Удаление канала — всегда вверху справа (как в режиме с контактом),
              чтобы кнопка не «прыгала» верх-иконкой / низ-футером. */}
          <RemovePlacementButton
            wsId={wsId}
            projectId={projectId}
            placementId={placement.id}
            onRemoved={onRemoved}
            className="shrink-0"
          />
        </div>
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
  // флудить). Почему (ресерч по исходникам TDLib, github.com/tdlib/td):
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
    actReceived: !!p.actReceivedAt,
  };
}

export function ProductionPane({
  wsId,
  projectId,
  placement,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
}) {
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(wsId);
  const [draft, setDraft] = useState<ProdDraft>(() => toProd(placement));
  // Ресинк с сервером: pane кейится по placement.id (не пересоздаётся на рефетч
  // того же размещения), поэтому при изменении серверных данных подтягиваем их —
  // но только если у менеджера нет несохранённых правок (draft == старый сервер),
  // иначе не затираем его ввод.
  const [serverBaseline, setServerBaseline] = useState(() =>
    JSON.stringify(toProd(placement)),
  );
  const serverNow = JSON.stringify(toProd(placement));
  if (serverNow !== serverBaseline) {
    if (JSON.stringify(draft) === serverBaseline) setDraft(toProd(placement));
    setServerBaseline(serverNow);
  }
  // Какой шаг раскрыт вручную (клик по шапке). null → раскрыт текущий (первый
  // незакрытый). Сброс при смене блогера — pane пересоздаётся по key.
  const [openStep, setOpenStep] = useState<string | null>(null);
  const set = <K extends keyof ProdDraft>(k: K, v: ProdDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  // Прыжок к помеченному сообщению в чате справа (клик «открыть в чате»). nonce
  // растёт на каждый клик — повторный прыжок к тому же id срабатывает снова.
  const [jumpTo, setJumpTo] = useState<{
    messageId: string;
    nonce: number;
  } | null>(null);
  const jumpToMessage = (messageId: string) =>
    setJumpTo((j) => ({ messageId, nonce: (j?.nonce ?? 0) + 1 }));

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
            // postUrl/publishedAt владеет capture-post (резолв+снапшот), не save.
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

  // Помеченные сообщения (договор/креатив/акт). Бейджим в чате по messageId.
  const stepMessages = placement.stepMessages ?? {};
  const taggedKindByMessageId: Record<string, MessageTagKind> = {};
  for (const kind of ["contract", "creative", "act"] as const) {
    const ref = stepMessages[kind];
    if (ref) taggedKindByMessageId[ref.messageId] = kind;
  }
  // Запись/снятие тега — атомарно на сервере (PUT/DELETE merge в jsonb), без
  // read-modify-write: быстрые двойные пометки не затирают друг друга.
  const tagMut = useMutation({
    mutationFn: async (args: {
      kind: MessageTagKind;
      ref: MessageTagRef | null;
    }) => {
      const path = {
        wsId,
        projectId,
        placementId: placement.id,
        kind: args.kind,
      };
      if (args.ref) {
        const { error } = await api.PUT(
          "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
          { params: { path }, body: args.ref },
        );
        if (error) throw error;
        // Пометка креатива переводит его в internal_review атомарно на бэке
        // (PUT step-message) — здесь ничего доставлять не нужно.
      } else {
        const { error } = await api.DELETE(
          "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
          { params: { path } },
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({
        queryKey: ["step-message", wsId, projectId, placement.id],
      });
    },
  });

  // ЕРИД-отправка в чат: один клик шлёт erid+данные блогеру (через quick-send,
  // ручной путь) и фиксирует erid_sent_at. Повторяемо. Аккаунт — отправляющий
  // по размещению (после активации), иначе аккаунт помеченного сообщения/первый.
  const adminContactId = placement.adminContactId;
  const sendAccountId =
    placement.account?.id ??
    stepMessages.creative?.accountId ??
    stepMessages.contract?.accountId ??
    accountsQ.data?.[0]?.id ??
    null;
  const eridSend = useMutation({
    mutationFn: async () => {
      if (!adminContactId || !sendAccountId) {
        throw new Error("Нет привязанного админа или аккаунта для отправки");
      }
      const text = `ERID: ${draft.erid}\nРекламодатель: ${draft.eridAdvertiserData}\n\nНанесите «Реклама» + ERID в левый нижний угол креатива.`;
      const { error: sErr } = await api.POST("/v1/workspaces/{wsId}/quick-send", {
        params: { path: { wsId } },
        body: { accountId: sendAccountId, contactId: adminContactId, text },
      });
      if (sErr) throw sErr;
      const { error: pErr } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            erid: draft.erid || null,
            eridAdvertiserData: draft.eridAdvertiserData || null,
            eridSentAt: new Date().toISOString(),
          },
        },
      );
      if (pErr) throw pErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
      qc.invalidateQueries({ queryKey: ["chat-history"] });
    },
  });

  // «Договор подписан» — действие-кнопка, не черновик: персистим сразу (иначе
  // правка теряется при уходе без Save). Держим draft в синхроне, чтобы внизу
  // не всплывала лишняя «Сохранить».
  const markContractSigned = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { contractStatus: "signed" },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      set("contractStatus", "signed");
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
    },
  });

  // Зона помеченного сообщения в шаге: рендер на лету + «убрать», иначе подсказка.
  // Drop-зона договора: дроп файла на блок «Договор» → отправляем блогеру (тот же
  // send-document, что и чат), менеджер пометит сообщение в чате после доставки.
  const [docDragOver, setDocDragOver] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const uploadDoc = async (file: File) => {
    if (!placement.adminContactId || !sendAccountId) return;
    setDocUploading(true);
    setDocError(null);
    try {
      await sendContactDocument(
        wsId,
        placement.adminContactId,
        sendAccountId,
        file,
      );
      qc.invalidateQueries({
        queryKey: ["chat-history", wsId, placement.adminContactId],
      });
    } catch (e) {
      setDocError(e instanceof Error ? e.message : "Не удалось отправить файл");
    } finally {
      setDocUploading(false);
    }
  };

  const renderTagArea = (kind: MessageTagKind) =>
    stepMessages[kind] ? (
      <div className="space-y-1">
        {/* Договор — это файл, превью бесполезно: компактная плашка + прыжок в
            чат. Креатив/акт показываем как есть (TaggedMessageView). */}
        {kind === "contract" ? (
          <button
            type="button"
            onClick={() => jumpToMessage(stepMessages.contract!.messageId)}
            className="flex w-full items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-left text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          >
            <Check size={14} className="shrink-0" />
            <span className="flex-1">Договор отправлен</span>
            <span className="shrink-0 text-emerald-600 underline">
              открыть в чате
            </span>
          </button>
        ) : (
          <TaggedMessageView
            wsId={wsId}
            projectId={projectId}
            placementId={placement.id}
            kind={kind}
          />
        )}
        <button
          type="button"
          onClick={() => tagMut.mutate({ kind, ref: null })}
          disabled={tagMut.isPending}
          className="text-[11px] text-zinc-400 hover:text-red-600 disabled:opacity-50"
        >
          убрать пометку
        </button>
      </div>
    ) : kind === "contract" && placement.adminContactId ? (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDocDragOver(true);
        }}
        onDragLeave={() => setDocDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDocDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void uploadDoc(f);
        }}
        className={
          "rounded-lg border border-dashed px-2 py-2.5 text-center text-[11px] " +
          (docError
            ? "border-red-300 bg-red-50 text-red-700"
            : docDragOver
              ? "border-emerald-400 bg-emerald-50 text-emerald-700"
              : "border-zinc-300 text-zinc-400")
        }
      >
        {docUploading
          ? "Отправляем…"
          : docError
            ? `Не отправилось: ${docError}. Перетащите ещё раз.`
            : "Перетащите файл договора — отправим блогеру, затем пометьте в чате"}
      </div>
    ) : (
      <p className="text-[11px] text-zinc-400">
        Пометьте сообщение в чате справа → «{MESSAGE_TAG_LABEL[kind]}».
      </p>
    );

  const dirty = JSON.stringify(draft) !== JSON.stringify(toProd(placement));
  const prod = deriveProduction(placement);
  const owner = PROD_OWNER[prod.owner];

  // Степпер-гармошка: раскрыт текущий (первый незакрытый), сделанные свёрнуты
  // зелёным summary, будущие приглушены. Дата выхода свёрнута внутрь «Публикации».
  const steps: {
    key: string;
    icon: React.ReactNode;
    title: string;
    done: boolean;
    summary: string;
    body: React.ReactNode;
  }[] = [
    {
      key: "contract",
      icon: <FileText size={15} />,
      title: "Договор",
      done: draft.contractStatus === "signed",
      summary: "Подписан · сканы/ЭДО",
      // Статус ведём от факта: отправка договора (drop) → пометка в чате
      // проставляет «отправлен» автоматически; «подписан» — кнопкой ниже.
      body: (
        <div className="space-y-2">
          {renderTagArea("contract")}
          {stepMessages.contract && draft.contractStatus !== "signed" && (
            <button
              type="button"
              onClick={() => markContractSigned.mutate()}
              disabled={markContractSigned.isPending}
              className="w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {markContractSigned.isPending ? "Сохраняем…" : "Договор подписан"}
            </button>
          )}
        </div>
      ),
    },
    {
      key: "creative",
      icon: <ImageIcon size={15} />,
      title:
        draft.creativeRound > 1
          ? `Креатив · раунд ${draft.creativeRound}`
          : "Креатив",
      done: draft.creativeStatus === "approved",
      summary: `Одобрен клиентом${draft.creativeRound > 1 ? ` · v${draft.creativeRound}` : ""}`,
      body: stepMessages.creative ? (
        <CreativeStep
          wsId={wsId}
          projectId={projectId}
          placement={placement}
          sendAccountId={sendAccountId}
          adminContactId={adminContactId}
          onUntag={() => tagMut.mutate({ kind: "creative", ref: null })}
        />
      ) : (
        <p className="text-[11px] text-zinc-400">
          Пометьте сообщение блогера с креативом в чате справа → «Креатив».
        </p>
      ),
    },
    {
      key: "erid",
      icon: <Hash size={15} />,
      title: "ЕРИД + данные рекламодателя",
      done: !!draft.erid,
      summary: draft.erid ? `${draft.erid} · данные переданы` : "",
      body: (
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => eridSend.mutate()}
              disabled={
                !draft.erid || !adminContactId || !sendAccountId || eridSend.isPending
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send size={13} />
              {eridSend.isPending
                ? "Отправляем…"
                : placement.eridSentAt
                  ? "Отправить снова"
                  : "Отправить в чат"}
            </button>
            {placement.eridSentAt && (
              <span className="text-[11px] text-emerald-700">
                отправлено {formatPastRelative(placement.eridSentAt)}
              </span>
            )}
          </div>
          {!adminContactId && (
            <p className="text-[11px] text-amber-600">
              Нет привязанного админа — отправить нельзя.
            </p>
          )}
          {eridSend.error && (
            <p className="text-[11px] text-red-600">
              {errorMessage(eridSend.error)}
            </p>
          )}
          <p className="text-[11px] text-zinc-400">
            Блогер наносит «Реклама» + ERID на картинку (левый нижний угол).
          </p>
        </div>
      ),
    },
    {
      key: "publish",
      icon: <Eye size={15} />,
      title: "Публикация",
      done: !!placement.postUrl,
      summary: draft.scheduledDate ? `Вышел · ${draft.scheduledDate}` : "Вышел",
      body: (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-zinc-500">
            Дата выхода
            <input
              type="date"
              value={draft.scheduledDate}
              onChange={(e) => set("scheduledDate", e.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </label>
          <PublishStep
            wsId={wsId}
            projectId={projectId}
            placement={placement}
          />
        </div>
      ),
    },
    {
      key: "act",
      icon: <FileCheck size={15} />,
      title: "Акт",
      done: draft.actReceived,
      summary: "Акт получен",
      body: (
        <div className="space-y-2">
          {renderTagArea("act")}
          <label className="flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={draft.actReceived}
              onChange={(e) => set("actReceived", e.target.checked)}
            />
            Акт получен от блогера
          </label>
        </div>
      ),
    },
  ];
  // «Текущий» шаг для авто-раскрытия считаем по СОХРАНЁННОМУ состоянию, не по
  // live-черновику — иначе правка поля (напр. статус→«подписан») флипала бы done
  // и схлопывала редактируемый шаг до автосейва.
  const saved = toProd(placement);
  const doneServer = [
    saved.contractStatus === "signed",
    saved.creativeStatus === "approved",
    !!saved.erid,
    !!placement.postUrl,
    saved.actReceived,
  ];
  const currentIdx = doneServer.findIndex((d) => !d);
  const openKey = openStep ?? (currentIdx >= 0 ? steps[currentIdx]!.key : null);

  return (
    <div className="flex h-full">
      {/* Левая зона: степпер шагов производства + автосейв. */}
      <div className="flex w-[440px] shrink-0 flex-col border-r border-zinc-200">
        <div className="border-b border-zinc-200 px-5 py-3">
          <div className="truncate font-semibold text-zinc-900">
            {placement.channel?.title ?? "Канал удалён"}
          </div>
          <div className="text-xs text-zinc-500">
            {placement.channel?.username
              ? `@${placement.channel.username}`
              : "—"}
          </div>
          <div
            className={
              "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
              owner.soft +
              " " +
              owner.text
            }
          >
            <span className={"h-1.5 w-1.5 rounded-full " + owner.dot} />
            {prod.stage}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {steps.map((s, i) => {
            const state = s.done
              ? "done"
              : i === currentIdx
                ? "current"
                : "future";
            const expanded = openKey === s.key;
            const last = i === steps.length - 1;
            return (
              <div key={s.key} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
                      (state === "done"
                        ? "bg-emerald-500 text-white"
                        : state === "current"
                          ? "border-2 border-emerald-500 bg-white"
                          : "border-2 border-zinc-300 bg-white")
                    }
                  >
                    {state === "done" ? (
                      <Check size={13} />
                    ) : state === "current" ? (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    ) : null}
                  </span>
                  {!last && (
                    <div
                      className={
                        "mt-1 w-px flex-1 " +
                        (s.done ? "bg-emerald-300" : "bg-zinc-200")
                      }
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <button
                    type="button"
                    onClick={() => setOpenStep(s.key)}
                    className={
                      "flex items-center gap-1.5 text-sm font-medium " +
                      (state === "future" ? "text-zinc-400" : "text-zinc-800")
                    }
                  >
                    {s.icon}
                    {s.title}
                  </button>
                  {expanded ? (
                    <div className="mt-2">{s.body}</div>
                  ) : s.done && s.summary ? (
                    <div className="mt-1 text-xs text-emerald-700">
                      {s.summary}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
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

      {/* Правая зона: чат с админом канала (как в инбоксе лонглиста). */}
      <div className="min-w-0 flex-1">
        {placement.adminContactId ? (
          <LeadChatPanel
            wsId={wsId}
            lead={{
              id: placement.id,
              contactId: placement.adminContactId,
              // Пиним аккаунт реального DM (через него шла переписка/оффер) —
              // чтобы чат открылся на нём, а тег/ERID ушли с него же, а не с
              // accounts[0] (важно для мульти-аккаунт воркспейса).
              account: placement.account ? { id: placement.account.id } : null,
            }}
            accounts={accountsQ.data ?? []}
            onTagMessage={(kind, ref) => tagMut.mutate({ kind, ref })}
            taggedKindByMessageId={taggedKindByMessageId}
            jumpTo={jumpTo}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
            Контакт админа не привязан — добавьте его в Лонглисте, чтобы
            переписываться здесь.
          </div>
        )}
      </div>
    </div>
  );
}

// Шаг «Креатив» (фаза «Запуск»): живое full-res превью помеченного креатива +
// действия-кнопки вместо селекта статусов. Статус ведётся прямыми мутациями
// (персист сразу, не через черновик). Превью читается на лету — если блогер
// отредактировал то же сообщение, менеджер видит новый вариант.
function CreativeStep({
  wsId,
  projectId,
  placement,
  sendAccountId,
  adminContactId,
  onUntag,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  sendAccountId: string | null;
  adminContactId: string | null;
  onUntag: () => void;
}) {
  const qc = useQueryClient();
  const status = placement.creativeStatus;
  const clientComment = placement.creativeClientComment;
  const q = useQuery({
    queryKey: [
      "step-message",
      wsId,
      projectId,
      placement.id,
      "creative",
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
        {
          params: {
            path: { wsId, projectId, placementId: placement.id, kind: "creative" },
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    staleTime: 30_000,
  });
  const messages = q.data?.messages ?? [];
  const media = q.data?.media ?? [];
  const editDate = q.data?.editDate ?? null;
  // Блогер правит то же сообщение → красным, если правка ПОЗЖЕ отправки клиенту.
  const editedAfterSent = !!(
    editDate &&
    placement.creativeClientSentAt &&
    new Date(editDate) > new Date(placement.creativeClientSentAt)
  );
  const text = messages
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n");
  const mediaUrl = (idx: number) =>
    `/v1/workspaces/${wsId}/projects/${projectId}/placements/${placement.id}/step-media/creative/${idx}`;

  // Статус-мутации меняют только creativeStatus (живёт в placement) — кэш
  // креатива (step-message) НЕ трогаем, иначе лишний перечит сообщения с TDLib.
  // Содержимое креатива перечитается само по staleTime / при смене блогера.
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] });
  const patchStatus = async (body: {
    creativeStatus: "client_review";
    creativeRound?: number;
  }) => {
    const { error } = await api.PATCH(
      "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
      { params: { path: { wsId, projectId, placementId: placement.id } }, body },
    );
    if (error) throw error;
  };
  // Отправка креатива клиенту. bumpRound=true — после правок блогера (новый
  // раунд). Кнопки «Показать клиенту» и «снова» в разных ветках статуса —
  // одновременно не видны, поэтому общий isPending/error безопасен.
  const sendToClient = useMutation({
    mutationFn: (bumpRound: boolean) =>
      patchStatus({
        creativeStatus: "client_review",
        ...(bumpRound ? { creativeRound: placement.creativeRound + 1 } : {}),
      }),
    onSuccess: invalidate,
  });

  // Переслать коммент клиента блогеру (quick-send, человеко-флоу). Текст
  // редактируемый — правки клиента ≠ дословно то, что просим у блогера.
  const [fwdOpen, setFwdOpen] = useState(false);
  const [fwdText, setFwdText] = useState("");
  const forward = useMutation({
    mutationFn: async () => {
      if (!adminContactId || !sendAccountId) {
        throw new Error("Нет аккаунта или контакта для отправки");
      }
      const { error } = await api.POST("/v1/workspaces/{wsId}/quick-send", {
        params: { path: { wsId } },
        body: { accountId: sendAccountId, contactId: adminContactId, text: fwdText },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFwdOpen(false);
      qc.invalidateQueries({ queryKey: ["chat-history"] });
    },
  });

  return (
    <div className="space-y-2">
      {q.isLoading ? (
        <p className="text-[11px] text-zinc-400">Загрузка креатива…</p>
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
          Сообщение недоступно (удалено или вне кэша) — перепометьте.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          {media.length > 0 && (
            <div
              className={
                "grid gap-0.5 bg-zinc-100 " +
                (media.length === 1 ? "grid-cols-1" : "grid-cols-2")
              }
            >
              {media.map((m) => (
                <div key={m.idx} className="relative bg-zinc-50">
                  <img
                    src={mediaUrl(m.idx)}
                    alt=""
                    loading="lazy"
                    className="max-h-72 w-full object-contain"
                  />
                  {m.kind === "video" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-2xl text-white">
                      ▶
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {text && (
            <div className="whitespace-pre-wrap break-words px-2 py-1.5 text-xs text-zinc-700">
              {renderMessageEntities(
                text,
                messages.flatMap((m) => m.entities as MessageEntity[]),
              )}
            </div>
          )}
        </div>
      )}

      {editDate && (
        <p
          className={
            "text-[11px] " +
            (editedAfterSent ? "font-medium text-red-600" : "text-zinc-400")
          }
        >
          {editedAfterSent
            ? "⚠ Креатив изменён ПОСЛЕ отправки клиенту"
            : "Отредактирован"}{" "}
          · {formatPastRelative(editDate)}
        </p>
      )}

      {status === "approved" ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <Check size={14} /> Клиент одобрил креатив
        </div>
      ) : status === "client_review" ? (
        <div className="rounded-md bg-blue-50 px-2 py-1 text-[11px] text-blue-700">
          У клиента на согласовании — ждём ответа.
        </div>
      ) : status === "revising" ? (
        <div className="space-y-1.5">
          {clientComment && (
            <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
              Клиент просит правки: {clientComment}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFwdText(clientComment ?? "");
                setFwdOpen((v) => !v);
              }}
              disabled={!adminContactId || !sendAccountId}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Send size={12} /> Переслать блогеру
            </button>
            <button
              type="button"
              onClick={() => sendToClient.mutate(true)}
              disabled={sendToClient.isPending}
              className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {sendToClient.isPending ? "…" : "Показать клиенту снова"}
            </button>
          </div>
          {fwdOpen && (
            <div className="space-y-1.5 rounded-lg border border-zinc-200 p-2">
              <textarea
                rows={3}
                value={fwdText}
                onChange={(e) => setFwdText(e.target.value)}
                placeholder="Что просим поправить у блогера"
                className="w-full resize-none rounded-md border border-zinc-300 px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => forward.mutate()}
                disabled={forward.isPending || !fwdText.trim()}
                className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {forward.isPending ? "Отправляем…" : "Отправить блогеру"}
              </button>
              {forward.error && (
                <p className="text-[11px] text-red-600">
                  {errorMessage(forward.error)}
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        // none / awaiting / internal_review — креатив на нашей проверке
        <button
          type="button"
          onClick={() => sendToClient.mutate(false)}
          disabled={sendToClient.isPending}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {sendToClient.isPending ? "Отправляем…" : "Показать клиенту"}
        </button>
      )}

      <div>
        <button
          type="button"
          onClick={onUntag}
          className="text-[11px] text-zinc-400 hover:text-red-600"
        >
          убрать пометку
        </button>
      </div>
      {sendToClient.error && (
        <p className="text-[11px] text-red-600">
          {errorMessage(sendToClient.error)}
        </p>
      )}
    </div>
  );
}

// Шаг «Публикация»: вставка ссылки → резолв+проверка «пост в этом канале» на
// бэке → снимок (текст+тамбнейл+метрики, файлы НЕ храним) → превью прямо здесь.
// Медиа в превью тянется on-demand (пост жив → full-res, удалён → тамбнейл).
function PublishStep({
  wsId,
  projectId,
  placement,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(placement.postUrl ?? "");
  const snap = placement.postSnapshot;
  const channelId = placement.channel?.id;
  const capture = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/capture-post",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: { url: url.trim() },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["placements", wsId, projectId] }),
  });
  const thumb: MessageThumb | null = snap?.thumbB64
    ? {
        kind: snap.media?.kind ?? "photo",
        b64: snap.thumbB64,
        width: snap.thumbW ?? 1,
        height: snap.thumbH ?? 1,
      }
    : null;
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://t.me/channel/123"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => capture.mutate()}
          disabled={capture.isPending || !url.trim()}
          className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {capture.isPending ? "Проверяем…" : "Проверить и сохранить"}
        </button>
      </div>
      {capture.error && (
        <p className="text-[11px] text-red-600">{errorMessage(capture.error)}</p>
      )}
      {snap ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200">
          {snap.media && channelId ? (
            <FullResMedia
              src={`/v1/workspaces/${wsId}/channels/${channelId}/post-media/${snap.messageId}`}
              thumb={thumb}
              kind={snap.media.kind}
              width={snap.media.width}
              height={snap.media.height}
            />
          ) : thumb ? (
            <MessageMediaThumb thumb={thumb} />
          ) : snap.coverUrl ? (
            // YouTube/TikTok: обложка приходит URL'ом (у TikTok с TTL).
            <img
              src={snap.coverUrl}
              alt=""
              className="aspect-video w-full object-cover"
            />
          ) : null}
          {snap.text && (
            <div className="whitespace-pre-wrap break-words px-2 py-1.5 text-xs text-zinc-700">
              {renderMessageEntities(
                snap.text,
                (snap.entities ?? []) as MessageEntity[],
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-2 py-1.5 text-[11px] text-zinc-500">
            {snap.views != null && <span>👁 {snap.views}</span>}
            {snap.forwards != null && <span>↪ {snap.forwards}</span>}
            {(snap.reactions ?? []).map((r) => (
              <span key={r.emoji}>
                {r.emoji} {r.count}
              </span>
            ))}
            <a
              href={placement.postUrl ?? url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-emerald-600 underline"
            >
              открыть в Telegram
            </a>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-400">
          Вставьте ссылку на пост — проверим, что он вышел в этом канале, и
          сохраним его вид для отчёта.
        </p>
      )}
    </div>
  );
}

// Рендер помеченного сообщения (договор/креатив/акт) на лету через TDLib.
// Альбом = несколько сообщений. Медиа — minithumbnail (низкое разрешение, не
// храним файлы); менеджеру достаточно, у него есть чат. Удалено/вне кэша → плашка.
function TaggedMessageView({
  wsId,
  projectId,
  placementId,
  kind,
}: {
  wsId: string;
  projectId: string;
  placementId: string;
  kind: MessageTagKind;
}) {
  const q = useQuery({
    queryKey: ["step-message", wsId, projectId, placementId, kind] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/step-message/{kind}",
        { params: { path: { wsId, projectId, placementId, kind } } },
      );
      if (error) throw error;
      return data!.messages;
    },
    staleTime: 60_000,
  });
  if (q.isLoading) {
    return <div className="text-[11px] text-zinc-400">Загрузка сообщения…</div>;
  }
  const msgs = q.data ?? [];
  if (!msgs.length) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
        Сообщение недоступно (удалено или вне кэша) — перепометьте.
      </div>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
      {msgs.map((m) => (
        <div key={m.id} className="space-y-1">
          {m.mediaThumb && (
            <MessageMediaThumb thumb={m.mediaThumb as MessageThumb} />
          )}
          {m.text && (
            <div className="whitespace-pre-wrap break-words text-xs text-zinc-700">
              {renderMessageEntities(m.text, m.entities as MessageEntity[])}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


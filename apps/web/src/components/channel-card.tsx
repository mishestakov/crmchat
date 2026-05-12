import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Eye,
  Forward,
  Gift,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  Send,
  X,
} from "lucide-react";
import type { Channel } from "@repo/core";
import { api } from "../lib/api";
import { formatRelative } from "../lib/date-utils";
import { errorMessage } from "../lib/errors";
import {
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  renderMessageEntities,
} from "../lib/tg-message";
import { ContactPicker } from "./contact-picker";

// Карточка канала: sticky-hero (avatar/title/key stats/description/meta-grid/
// admins) + scrollable feed постов (TG-style: bubble + views/forwards/replies/
// reactions). Скролл-up подгружает старые страницы. Используется в drawer'е
// /channels и в карточке контакта.
//
// Зеркалит бэковый UNAVAILABLE_COOLDOWN_MS (channels.ts) — пока кулдаун
// горит, фронт не звонит на api (бэк всё равно вернёт 410). Часовое
// значение должно совпадать.
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

export function ChannelCard(props: { wsId: string; channel: Channel }) {
  const { wsId, channel } = props;
  const qc = useQueryClient();

  // Sync свежей карточки из TG: stale-while-revalidate с TTL 24h. UI рендерит
  // что есть в БД, в фоне fetch'им свежее. На mount запускаем один раз через
  // ref-флаг — иначе после успешного sync'а props.channel.syncedAt обновится
  // и эффект ре-триггернётся.
  const SYNC_TTL_MS = 24 * 60 * 60 * 1000;
  const needsSync =
    !channel.syncedAt ||
    Date.now() - new Date(channel.syncedAt).getTime() > SYNC_TTL_MS;

  const inUnavailableCooldown =
    !!channel.unavailableLastCheckAt &&
    Date.now() - new Date(channel.unavailableLastCheckAt).getTime() <
      UNAVAILABLE_COOLDOWN_MS;

  const syncMut = useMutation({
    // force=true → бэк пропустит cooldown-gate. Используется кнопкой
    // «проверить сейчас» в UnavailableStatus; auto-sync дёргает без force.
    mutationFn: async (opts: { force?: boolean } = {}) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/sync",
        {
          params: {
            path: { wsId, id: channel.id },
            query: opts.force ? { force: true } : {},
          },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel", wsId, channel.id] });
      qc.invalidateQueries({
        queryKey: ["channel-history", wsId, channel.id],
      });
    },
    // На auto-sync список НЕ инвалидируем (member_count меняется → строка
    // прыгает под рукой). На force-sync (кнопка «проверить сейчас») —
    // инвалидируем независимо от успеха/провала, юзер ждёт обновлённый
    // статус (бейдж пропал / новая дата проверки).
    onSettled: (_data, _err, vars) => {
      if (vars.force) {
        qc.invalidateQueries({ queryKey: ["channels", wsId] });
      }
    },
  });

  // PATCH /channels/{id} — пока только username. На смене бэк сбрасывает
  // unavailable_*, поэтому после успешного PATCH даём auto-sync ещё один
  // шанс (он попытается на новом @ через cooldown-чистый канал).
  const patchMut = useMutation({
    mutationFn: async (body: { username: string | null }) => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/channels/{id}",
        {
          params: { path: { wsId, id: channel.id } },
          body,
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      qc.invalidateQueries({ queryKey: ["channel", wsId, channel.id] });
    },
  });
  const syncFailed = !!syncMut.error;

  // Per-channel ref: при переключении таба в карточке контакта компонент
  // не unmount'ится, props.channel.id меняется. Boolean-флаг «уже стартовали»
  // здесь бы заблокировал sync для второго канала; сравниваем с конкретным
  // id и сбрасываем при смене.
  const syncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      needsSync &&
      !inUnavailableCooldown &&
      syncedForRef.current !== channel.id &&
      !syncMut.isPending
    ) {
      syncedForRef.current = channel.id;
      syncMut.mutate({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  // Плашка причины из БД сразу при render'е, чтобы не было мерцания
  // «пустой sidebar → 410 → плашка». Незнакомый код или null reason →
  // нейтральный текст; не светим raw-код TG в UI.
  const persistedReason = channel.unavailableSince
    ? matchUnavailableReason(channel.unavailableReason ?? "") ??
      "Telegram не отдаёт этот чат."
    : null;
  const syncErrorRaw = syncMut.error ? errorMessage(syncMut.error) : null;
  const syncErrorReason = syncErrorRaw
    ? matchUnavailableReason(syncErrorRaw)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {persistedReason && (
        <UnavailableStatus
          reason={persistedReason}
          since={channel.unavailableSince}
          lastCheckAt={channel.unavailableLastCheckAt}
          username={channel.username}
          onCheckNow={() => syncMut.mutate({ force: true })}
          checking={syncMut.isPending}
          checkError={syncMut.error}
          onSaveUsername={(u) => patchMut.mutate({ username: u })}
          savingUsername={patchMut.isPending}
        />
      )}
      {!persistedReason && syncErrorRaw && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {syncErrorReason ?? `Не удалось обновить: ${syncErrorRaw}`}
        </div>
      )}
      <ChannelHero channel={channel} syncing={syncMut.isPending} />
      <MetaBadges channel={channel} />
      <AdminsSection wsId={wsId} channel={channel} />
      <PostsFeed
        wsId={wsId}
        channelId={channel.id}
        channelExternalId={channel.externalId}
        syncing={syncMut.isPending}
        syncFailed={syncFailed}
        unavailable={inUnavailableCooldown}
      />
    </div>
  );
}

function UnavailableStatus(props: {
  reason: string;
  since: string | null;
  lastCheckAt: string | null;
  username: string | null;
  onCheckNow: () => void;
  checking: boolean;
  checkError: unknown;
  onSaveUsername: (next: string | null) => void;
  savingUsername: boolean;
}) {
  const [draft, setDraft] = useState(props.username ?? "");
  const trimmed = draft.replace(/^@/, "").trim();
  const dirty = trimmed !== (props.username ?? "");
  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
      <div className="font-medium">{props.reason}</div>
      <div className="mt-1 text-xs text-red-700">
        {props.since && <>Недоступен {formatRelative(props.since)}</>}
        {props.since && props.lastCheckAt && " · "}
        {props.lastCheckAt && (
          <>последняя проверка {formatRelative(props.lastCheckAt)}</>
        )}
      </div>
      {props.checkError != null && (
        <div className="mt-1 text-xs text-red-700">
          {errorMessage(props.checkError)}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={props.onCheckNow}
          disabled={props.checking}
          className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {props.checking ? "Проверяем…" : "Проверить сейчас"}
        </button>
        <span className="text-xs text-red-700">@</span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) {
              props.onSaveUsername(trimmed || null);
            }
          }}
          disabled={props.savingUsername}
          className="w-40 rounded-md border border-red-300 bg-white px-2 py-1 text-xs focus:border-red-500 focus:outline-none disabled:opacity-50"
          placeholder="username"
        />
        {dirty && (
          <button
            type="button"
            onClick={() => props.onSaveUsername(trimmed || null)}
            disabled={props.savingUsername}
            className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {props.savingUsername ? "…" : "Сохранить"}
          </button>
        )}
      </div>
    </div>
  );
}

function ChannelHero(props: { channel: Channel; syncing: boolean }) {
  const { channel } = props;
  const meta = channel.meta as Record<string, unknown>;
  const isVerified = meta?.is_verified === true;
  const boostLevel =
    typeof meta?.boost_level === "number" ? meta.boost_level : 0;
  const createdAtTg =
    typeof meta?.created_at_tg === "number" ? meta.created_at_tg : null;

  return (
    <header className="border-b border-zinc-100 px-6 pb-5 pt-6">
      <div className="flex items-start gap-4">
        {channel.thumbnailB64 ? (
          <img
            src={`data:image/jpeg;base64,${channel.thumbnailB64}`}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-zinc-200 blur-[1.5px]"
          />
        ) : (
          <div
            className={
              "flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 text-base font-semibold text-zinc-500" +
              (props.syncing ? " animate-pulse" : "")
            }
          >
            {channel.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="flex items-center gap-1.5 text-lg font-semibold leading-tight tracking-tight text-zinc-900">
            <span className="truncate">{channel.title}</span>
            {isVerified && (
              <BadgeCheck
                size={18}
                className="shrink-0 fill-sky-500 text-white"
                aria-label="Верифицирован"
              />
            )}
          </h2>
          {channel.username && (
            <a
              href={`https://t.me/${channel.username}`}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-emerald-700"
            >
              <span>@{channel.username}</span>
              <LinkIcon size={11} className="opacity-60" />
            </a>
          )}
          <div className="mt-3 flex items-baseline gap-6 text-sm">
            <Stat
              value={formatMembers(channel.memberCount)}
              label="подписчиков"
            />
            {createdAtTg && (
              <Stat value={formatAge(createdAtTg)} label="возраст" />
            )}
            {boostLevel > 0 && (
              <Stat value={`★ ${boostLevel}`} label="boost" tone="amber" />
            )}
          </div>
        </div>
      </div>
      {channel.description && (
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
          {channel.description}
        </p>
      )}
    </header>
  );
}

function Stat(props: {
  value: string;
  label: string;
  tone?: "default" | "amber";
}) {
  const valueTone =
    props.tone === "amber" ? "text-amber-600" : "text-zinc-900";
  return (
    <div className="flex flex-col">
      <span className={`text-base font-semibold tabular-nums ${valueTone}`}>
        {props.value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        {props.label}
      </span>
    </div>
  );
}

function MetaBadges({ channel }: { channel: Channel }) {
  const meta = channel.meta as Record<string, unknown>;
  const props = channel.properties as Record<string, unknown>;
  const hasDm = meta?.has_dm === true;
  const hasLinkedChat = meta?.has_linked_chat === true;
  const giftCount =
    typeof meta?.gift_count === "number" ? meta.gift_count : 0;
  const isBroadcastGroup = meta?.is_broadcast_group === true;

  // Custom properties (CSV-импорт): ER, ниша и пр. Показываем только
  // первичные строковые/числовые значения; multi-select оставим для
  // отдельной view (slot не позволяет красиво поместить в badge-row).
  const customEntries = Object.entries(props).filter(
    ([, v]) =>
      (typeof v === "string" && v.trim() !== "") ||
      (typeof v === "number" && Number.isFinite(v)),
  );

  const badges: { key: string; node: React.ReactNode }[] = [];
  if (hasDm) {
    badges.push({
      key: "dm",
      node: (
        <Badge tone="emerald" icon={Send}>
          Можно в личку
        </Badge>
      ),
    });
  }
  if (hasLinkedChat) {
    badges.push({
      key: "linked",
      node: (
        <Badge tone="zinc" icon={MessageSquare}>
          Связанный чат
        </Badge>
      ),
    });
  }
  if (isBroadcastGroup) {
    badges.push({
      key: "broadcast",
      node: <Badge tone="zinc">Broadcast group</Badge>,
    });
  }
  if (giftCount > 0) {
    badges.push({
      key: "gifts",
      node: (
        <Badge tone="amber" icon={Gift}>
          {giftCount} {pluralRu(giftCount, "подарок", "подарка", "подарков")}
        </Badge>
      ),
    });
  }
  for (const [k, v] of customEntries) {
    badges.push({
      key: `prop:${k}`,
      node: (
        <Badge tone="zinc">
          <span className="text-zinc-500">{k}</span>{" "}
          <span className="font-semibold text-zinc-800">{String(v)}</span>
        </Badge>
      ),
    });
  }

  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-6 py-3">
      {badges.map((b) => (
        <span key={b.key}>{b.node}</span>
      ))}
    </div>
  );
}

function Badge(props: {
  tone: "emerald" | "zinc" | "amber";
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  const tones: Record<typeof props.tone, string> = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200/60",
    zinc: "bg-zinc-50 text-zinc-700 ring-zinc-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200/60",
  };
  const Icon = props.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ${tones[props.tone]}`}
    >
      {Icon && <Icon size={11} className="opacity-80" />}
      {props.children}
    </span>
  );
}

function AdminsSection(props: { wsId: string; channel: Channel }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const removeMut = useMutation({
    mutationFn: async (contactId: string) => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
        {
          params: {
            path: { wsId: props.wsId, id: props.channel.id, contactId },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", props.wsId] });
      qc.invalidateQueries({ queryKey: ["channel", props.wsId, props.channel.id] });
      qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
    },
  });

  const addMut = useMutation({
    mutationFn: async (contactId: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/admins",
        {
          params: { path: { wsId: props.wsId, id: props.channel.id } },
          body: { contactIds: [contactId] },
        },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", props.wsId] });
      qc.invalidateQueries({ queryKey: ["channel", props.wsId, props.channel.id] });
      qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
      setAdding(false);
    },
  });

  const admins = props.channel.admins;

  return (
    <section className="border-b border-zinc-100 px-6 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          Админы {admins.length > 0 && `· ${admins.length}`}
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-emerald-700 hover:text-emerald-800"
          >
            <Plus size={12} />
            Добавить
          </button>
        )}
      </div>
      {admins.length === 0 && !adding && (
        <p className="text-xs text-zinc-400">Не привязаны</p>
      )}
      {admins.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {admins.map((a) => {
            const label =
              a.fullName ||
              (a.telegramUsername ? `@${a.telegramUsername}` : a.contactId);
            return (
              <li
                key={a.contactId}
                className="group inline-flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-3 pr-1 text-xs hover:bg-zinc-200"
              >
                <Link
                  to="/w/$wsId/contacts/$id"
                  params={{ wsId: props.wsId, id: a.contactId }}
                  className="flex items-center gap-1.5 truncate text-zinc-800 hover:text-emerald-700"
                >
                  <span>{label}</span>
                  {a.telegramUsername && a.fullName && (
                    <span className="text-zinc-400">@{a.telegramUsername}</span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Отвязать «${label}» от канала?`)) {
                      removeMut.mutate(a.contactId);
                    }
                  }}
                  disabled={removeMut.isPending}
                  className="rounded-full p-0.5 text-zinc-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                  aria-label="Отвязать"
                  title="Отвязать админа от канала"
                >
                  <X size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <ContactPicker
          wsId={props.wsId}
          excludeIds={new Set(admins.map((a) => a.contactId))}
          onPick={(contactId) => addMut.mutate(contactId)}
          onCancel={() => setAdding(false)}
          loading={addMut.isPending}
        />
      )}
    </section>
  );
}

// Маппим raw TDLib/MTProto-коды в человеческую русскую фразу. Подстрока,
// case-insensitive — бэк может возвращать как «Telegram lookup failed:
// USERNAME_NOT_OCCUPIED», так и «channel unavailable: Chat not found».
const UNAVAILABLE_REASONS: { pattern: RegExp; ru: string }[] = [
  {
    pattern: /chat not found/i,
    ru: "Telegram не отдаёт этот чат — приватный, удалён или нет доступа.",
  },
  {
    pattern: /username_not_occupied/i,
    ru: "Такого @username нет в Telegram (возможно, канал переименован).",
  },
  {
    pattern: /username_invalid/i,
    ru: "@username канала записан с ошибкой.",
  },
  {
    pattern: /channel_private/i,
    ru: "Приватный канал — у привязанного аккаунта нет доступа.",
  },
  {
    pattern: /channel_invalid/i,
    ru: "Неверный идентификатор канала.",
  },
  {
    pattern: /peer_id_invalid/i,
    ru: "Канал не распознан Telegram'ом.",
  },
];

function matchUnavailableReason(raw: string): string | null {
  for (const r of UNAVAILABLE_REASONS) {
    if (r.pattern.test(raw)) return r.ru;
  }
  return null;
}

type ChannelMessage = {
  id: string;
  date: string;
  text: string;
  entities: MessageEntity[];
  mediaThumb: MessageThumb | null;
  views: number | null;
  forwards: number | null;
  replies: number | null;
  reactions: { emoji: string; count: number }[];
  isForwarded: boolean;
};

function PostsFeed(props: {
  wsId: string;
  channelId: string;
  channelExternalId: string | null;
  syncing: boolean;
  syncFailed: boolean;
  // Канал помечен недоступным и кулдаун ещё не истёк. /history всё равно
  // вернёт 410, поэтому не дёргаем — UI поверх показывает persistedReason.
  unavailable: boolean;
}) {
  const PAGE_LIMIT = 50;
  const enabled =
    !!props.channelExternalId &&
    !props.syncing &&
    !props.syncFailed &&
    !props.unavailable;

  // Initial page (newest 50). Стабильный queryKey без before — повторное
  // открытие drawer'а идёт из кэша, не дёргает TDLib (см. staleTime).
  const initialQ = useQuery({
    queryKey: ["channel-history", props.wsId, props.channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/history",
        {
          params: {
            path: { wsId: props.wsId, id: props.channelId },
            query: { limit: PAGE_LIMIT },
          },
        },
      );
      if (error) throw error;
      return data!.messages as ChannelMessage[];
    },
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Аккумулятор «более старых» страниц (prepend). Сбрасывается на смену
  // channelId.
  const [olderPages, setOlderPages] = useState<ChannelMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);

  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
    setLoadMoreError(null);
    setLoadingMore(false);
    didAutoScrollRef.current = false;
  }, [props.channelId]);

  // По td_api.tl §getChatHistory: единственный надёжный сигнал «больше
  // нет» — пустой ответ. length < limit может быть chunk-границей.
  useEffect(() => {
    if (initialQ.data && initialQ.data.length === 0) setHasMore(false);
  }, [initialQ.data]);

  // TDLib отдаёт newest-first → разворачиваем в oldest-first для рендера.
  // olderPages уже в oldest-first (см. prepend ниже), идут перед initial.
  const messages: ChannelMessage[] = initialQ.data
    ? [...olderPages, ...[...initialQ.data].reverse()]
    : olderPages;

  // После initial load — auto-scroll в самый низ (newest message виден).
  // Один раз на channelId; при prepend от scroll-up НЕ скроллим,
  // сохраняем визуальное место юзера в onScroll.
  useEffect(() => {
    if (!initialQ.isSuccess) return;
    if (didAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didAutoScrollRef.current = true;
  }, [initialQ.isSuccess]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (!initialQ.isSuccess || !hasMore || loadingMore) return;
    const el = e.currentTarget;
    if (el.scrollTop > 50) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const prevHeight = el.scrollHeight;
    api
      .GET("/v1/workspaces/{wsId}/channels/{id}/history", {
        params: {
          path: { wsId: props.wsId, id: props.channelId },
          query: { limit: PAGE_LIMIT, fromMessageId: Number(oldestId) },
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const page = (data!.messages as ChannelMessage[]) ?? [];
        if (page.length === 0) {
          setHasMore(false);
        } else {
          setOlderPages((prev) => [...[...page].reverse(), ...prev]);
          // Сохраняем визуальное место юзера после prepend'а.
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevHeight;
          });
        }
        setLoadingMore(false);
      })
      .catch((e) => {
        setLoadMoreError(e);
        setLoadingMore(false);
      });
  };

  if (props.unavailable) {
    // Плашка с причиной уже отрисована поверх sidebar'а — здесь поле постов
    // оставляем пустым, без второго объяснения.
    return <div className="min-h-0 flex-1" />;
  }
  if (props.syncFailed) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Сначала нужна синхронизация с Telegram (см. сообщение выше).
      </div>
    );
  }
  if (!props.channelExternalId) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Нет привязки к Telegram — история недоступна.
      </div>
    );
  }
  if (initialQ.isLoading || (props.syncing && !initialQ.data)) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Загрузка истории…
      </div>
    );
  }
  if (initialQ.error) {
    const msg = errorMessage(initialQ.error);
    const reason = matchUnavailableReason(msg);
    return (
      <div className="min-h-0 flex-1 px-6 py-4">
        {reason ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            {reason}
          </div>
        ) : (
          <div className="text-sm text-red-600">{msg}</div>
        )}
      </div>
    );
  }
  if (initialQ.isSuccess && messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Постов нет.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 px-4 py-4"
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-2">
        {loadingMore && (
          <p className="py-1 text-center text-xs text-zinc-400">
            Подгружаем старые…
          </p>
        )}
        {loadMoreError != null && (
          <p className="py-1 text-center text-xs text-red-600">
            {errorMessage(loadMoreError)}
          </p>
        )}
        {!hasMore && !loadingMore && messages.length > 0 && (
          <p className="py-1 text-center text-[10px] uppercase tracking-wider text-zinc-400">
            Это начало канала
          </p>
        )}
        {messages.map((m) => (
          <Post key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}

function Post({ m }: { m: ChannelMessage }) {
  const hasInteractions =
    m.views !== null ||
    m.forwards !== null ||
    m.replies !== null ||
    m.reactions.length > 0;
  return (
    <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
      {m.mediaThumb && <MessageMediaThumb thumb={m.mediaThumb} />}
      <div className="px-4 py-3">
        {m.isForwarded && (
          <div className="mb-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
            <Forward size={10} />
            Репост
          </div>
        )}
        {m.text && (
          <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-zinc-900">
            {renderMessageEntities(m.text, m.entities)}
          </div>
        )}
        <div
          className={
            (m.text ? "mt-2 " : "") +
            "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500"
          }
        >
          <time
            dateTime={m.date}
            title={new Date(m.date).toLocaleString("ru-RU")}
            className="tabular-nums"
          >
            {formatRelative(m.date)}
          </time>
          {hasInteractions && <span className="text-zinc-300">·</span>}
          {m.views !== null && (
            <Metric icon={Eye}>{formatCompact(m.views)}</Metric>
          )}
          {m.forwards !== null && m.forwards > 0 && (
            <Metric icon={Forward}>{formatCompact(m.forwards)}</Metric>
          )}
          {m.replies !== null && m.replies > 0 && (
            <Metric icon={MessageSquare}>{formatCompact(m.replies)}</Metric>
          )}
          {m.reactions.map((r) => (
            <span
              key={r.emoji}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px]"
            >
              <span>{r.emoji}</span>
              <span className="tabular-nums text-zinc-600">
                {formatCompact(r.count)}
              </span>
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

function Metric(props: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon size={12} className="text-zinc-400" />
      {props.children}
    </span>
  );
}

// 5_444_566 → "5.4M", 12_345 → "12.3K", 999 → "999". Аналог формата
// «5.4M subscribers» в самом Telegram.
export function formatMembers(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "K";
  if (n >= 1_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// Компактный формат для views/forwards/reactions: «12.3K», «5.4M», иначе
// число как есть. От formatMembers отличается порогом: тут 1K-граница
// строже (10K → 10K, не 10000), в постах число «4567» читабельнее как
// «4.6K».
function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

// supergroup.date (unix sec) → «3 года», «8 месяцев», «12 дней». Грубая
// округлёнка, для оценки возраста канала достаточно.
function formatAge(unixSec: number): string {
  const ms = Date.now() - unixSec * 1000;
  if (ms < 0) return "—";
  const days = ms / (24 * 60 * 60 * 1000);
  if (days < 30) {
    const d = Math.max(1, Math.round(days));
    return `${d} ${pluralRu(d, "день", "дня", "дней")}`;
  }
  const months = days / 30;
  if (months < 12) {
    const m = Math.round(months);
    return `${m} ${pluralRu(m, "месяц", "месяца", "месяцев")}`;
  }
  const years = days / 365;
  const y = Math.round(years * 10) / 10;
  const yInt = Math.round(y);
  return `${y % 1 === 0 ? yInt : y} ${pluralRu(yInt, "год", "года", "лет")}`;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

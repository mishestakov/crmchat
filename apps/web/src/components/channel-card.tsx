import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { Channel } from "@repo/core";
import { api } from "../lib/api";
import { formatRelative } from "../lib/date-utils";
import { errorMessage } from "../lib/errors";

// Карточка канала: thumbnail/title/meta-шапка + sync-бар + лента истории
// (50 сообщений plain-text). Используется в drawer'е /channels и в карточке
// контакта.
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

  const syncMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/sync",
        { params: { path: { wsId, id: channel.id } } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      qc.invalidateQueries({ queryKey: ["channel", wsId, channel.id] });
      qc.invalidateQueries({
        queryKey: ["channel-history", wsId, channel.id],
      });
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
      syncedForRef.current !== channel.id &&
      !syncMut.isPending
    ) {
      syncedForRef.current = channel.id;
      syncMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader channel={channel} syncing={syncMut.isPending} />
      <div className="flex items-center justify-end gap-2 border-b border-zinc-200 px-4 py-2 text-xs text-zinc-500">
        {syncMut.isPending && <span>Синхронизация…</span>}
        {!syncMut.isPending && channel.syncedAt && (
          <span title={new Date(channel.syncedAt).toLocaleString("ru-RU")}>
            Обновлено: {formatRelative(channel.syncedAt)}
          </span>
        )}
        <button
          type="button"
          onClick={() => syncMut.mutate()}
          disabled={syncMut.isPending}
          className="text-emerald-700 hover:underline disabled:opacity-50"
        >
          Обновить
        </button>
      </div>
      {syncMut.error && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          {errorMessage(syncMut.error)}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-700">История</h3>
        <ChannelHistory
          wsId={wsId}
          channelId={channel.id}
          channelExternalId={channel.externalId}
          syncedAt={channel.syncedAt}
          syncing={syncMut.isPending}
          syncFailed={syncFailed}
        />
      </div>
    </div>
  );
}

// Шапка карточки: thumbnail (blurry minithumb из channel_thumbnails или
// буквенный плейсхолдер) + title + verified-галочка + @username + meta-row
// (member_count, has_dm, created_at_tg) + description. Все proprietary
// флаги читаем из jsonb meta — туда соц-pull кладёт TG-специфику.
function ChannelHeader(props: { channel: Channel; syncing: boolean }) {
  const { channel } = props;
  const meta = channel.meta as Record<string, unknown>;
  const isVerified = meta?.is_verified === true;
  const hasDm = meta?.has_dm === true;
  const createdAtTg =
    typeof meta?.created_at_tg === "number" ? (meta.created_at_tg as number) : null;
  return (
    <div className="border-b border-zinc-200 px-4 py-4">
      <div className="flex items-start gap-3">
        {channel.thumbnailB64 ? (
          <img
            src={`data:image/jpeg;base64,${channel.thumbnailB64}`}
            alt=""
            className="h-12 w-12 shrink-0 rounded-full object-cover blur-[1px]"
          />
        ) : (
          <div
            className={
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500" +
              (props.syncing ? " animate-pulse" : "")
            }
          >
            {channel.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h2 className="truncate text-base font-semibold text-zinc-900">
              {channel.title}
            </h2>
            {isVerified && (
              <span title="Верифицирован" className="text-sky-500">
                ✓
              </span>
            )}
          </div>
          {channel.username && (
            <a
              href={`https://t.me/${channel.username}`}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-emerald-700 hover:underline"
            >
              @{channel.username}
            </a>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>{formatMembers(channel.memberCount)} подписчиков</span>
            {hasDm && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                Можно в личку
              </span>
            )}
            {createdAtTg && (
              <span>
                Создан {new Date(createdAtTg * 1000).toLocaleDateString("ru-RU")}
              </span>
            )}
          </div>
        </div>
      </div>
      {channel.description && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600">
          {channel.description}
        </p>
      )}
    </div>
  );
}

// Лента истории: 50 plain-text сообщений. Дёргаем только когда есть
// external_id, sync завершён без ошибки. Без это схема: 0 active outreach
// → /sync 412 → /history тоже 412, плюс лишние ретраи.
function ChannelHistory(props: {
  wsId: string;
  channelId: string;
  channelExternalId: string | null;
  syncedAt: string | null;
  syncing: boolean;
  syncFailed: boolean;
}) {
  const enabled =
    !!props.channelExternalId && !props.syncing && !props.syncFailed;
  const historyQ = useQuery({
    queryKey: ["channel-history", props.wsId, props.channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/history",
        {
          params: {
            path: { wsId: props.wsId, id: props.channelId },
            query: { limit: 50 },
          },
        },
      );
      if (error) throw error;
      return data;
    },
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  if (props.syncFailed) {
    return (
      <p className="text-sm text-zinc-400">
        Сначала нужна синхронизация с Telegram (см. сообщение выше).
      </p>
    );
  }
  if (props.syncing && !props.syncedAt) {
    return <p className="text-sm text-zinc-400">Загрузка истории…</p>;
  }
  if (!props.channelExternalId) {
    return (
      <p className="text-sm text-zinc-400">
        Нет привязки к Telegram — история недоступна.
      </p>
    );
  }
  if (historyQ.isLoading) {
    return <p className="text-sm text-zinc-400">Загрузка истории…</p>;
  }
  if (historyQ.error) {
    return (
      <p className="text-sm text-red-600">{errorMessage(historyQ.error)}</p>
    );
  }
  const messages = historyQ.data?.messages ?? [];
  if (messages.length === 0) {
    return <p className="text-sm text-zinc-400">Сообщений нет.</p>;
  }
  return (
    <ul className="space-y-2">
      {messages.map((m) => (
        <li
          key={m.id}
          className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm"
        >
          <div className="mb-1 text-xs text-zinc-500">
            {formatRelative(m.date)}
          </div>
          <div className="whitespace-pre-wrap text-zinc-800">{m.text}</div>
        </li>
      ))}
    </ul>
  );
}

// 5_444_566 → "5.4M", 12_345 → "12.3K", 999 → "999". Аналог формата
// «5.4M subscribers» в самом Telegram. Экспортируем чтобы /channels
// таблица использовала тот же формат.
export function formatMembers(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "K";
  if (n >= 1_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

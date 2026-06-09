import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  CreditCard,
  Eye,
  Forward,
  Gift,
  Link as LinkIcon,
  Mail,
  MessageSquare,
  Phone,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Loader2,
  X,
} from "lucide-react";
import type { Channel, FieldDef } from "@repo/core";
import { api } from "../lib/api";
import { PropertyFields } from "./property-fields";
import { PLATFORMS, type Platform } from "../lib/platforms";
import { formatRelative } from "../lib/date-utils";
import { errorMessage } from "../lib/errors";
import { useOutreachAccounts } from "../lib/outreach-queries";
import {
  FullResMedia,
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  ReactionChips,
  renderMessageEntities,
} from "../lib/tg-message";
import { ContactPicker } from "./contact-picker";
import { MethodChatPanel } from "./method-chat-panel";
import { channelDm } from "../lib/channel-dm";

// Карточка канала: sticky-hero (avatar/title/key stats/description/meta-grid/
// admins) + scrollable feed постов (TG-style: bubble + views/forwards/replies/
// reactions). Скролл-up подгружает старые страницы. Используется в drawer'е
// /channels и в карточке контакта.
//
// Зеркалит бэковый UNAVAILABLE_COOLDOWN_MS (channels.ts) — пока кулдаун
// горит, фронт не звонит на api (бэк всё равно вернёт 410). Часовое
// значение должно совпадать.
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

export function ChannelCard(props: {
  wsId: string;
  channel: Channel;
  // compact — превью канала в центре лонглиста (этап 16.10): тонкая шапка,
  // description мелким+clamp, без бейджей/админов — только канал и его посты.
  compact?: boolean;
  // initialDmOpen — открыть карточку сразу с раскрытым тредом лички (клик по
  // DM-бейджу в каталоге каналов).
  initialDmOpen?: boolean;
}) {
  const { wsId, channel, compact } = props;
  const qc = useQueryClient();
  const [dmOpen, setDmOpen] = useState(props.initialDmOpen ?? false);
  // Личка канала (этап 16.9): 0⭐ → пишем из CRM, >0 → тред read-only (вручную).
  const { hasDm: hasDmGroup, starCost: dmStarCost } = channelDm(channel.meta);
  const accountsQ = useOutreachAccounts(wsId);
  // Синк через аккаунт-сессию: TG-канал нужен активный telegram-аккаунт,
  // MAX-канал — активный max-аккаунт (после обобщения таблицы — не «любой»).
  const hasActiveAccount =
    !!accountsQ.data &&
    accountsQ.data.some(
      (a) => a.status === "active" && a.platform === channel.platform,
    );

  // Каталог кастом-полей канала (тот же, что в настройках «Поля»). Нужен только
  // в развёрнутой карточке (drawer) — в compact-превью лонглиста не тянем.
  const propertyDefsQ = useQuery({
    queryKey: ["properties", wsId],
    queryFn: async () => {
      const { data, error } = await api.GET("/v1/workspaces/{wsId}/properties", {
        params: { path: { wsId } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !compact,
    staleTime: 5 * 60 * 1000,
  });

  // Sync свежей карточки из TG: stale-while-revalidate с TTL 24h. UI рендерит
  // что есть в БД, в фоне fetch'им свежее. На mount запускаем один раз через
  // ref-флаг — иначе после успешного sync'а props.channel.syncedAt обновится
  // и эффект ре-триггернётся.
  const SYNC_TTL_MS = 24 * 60 * 60 * 1000;
  const needsSync =
    !channel.syncedAt ||
    Date.now() - new Date(channel.syncedAt).getTime() > SYNC_TTL_MS;
  // YouTube/TikTok синкаются внешним провайдером без TDLib-аккаунта — для них
  // не требуем hasActiveAccount (иначе площадки воркспейса без TG-аккаунта
  // никогда не наполнятся ленивым синком после импорта).
  const isProviderPlatform =
    channel.platform === "youtube" ||
    channel.platform === "tiktok" ||
    channel.platform === "dzen";

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

  // PATCH /channels/{id} — username и/или кастом-свойства канала. На смене
  // username бэк сбрасывает unavailable_*, поэтому после успешного PATCH даём
  // auto-sync ещё один шанс (на новом @ через cooldown-чистый канал).
  const patchMut = useMutation({
    mutationFn: async (body: {
      username?: string | null;
      properties?: Record<string, unknown>;
    }) => {
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
      (isProviderPlatform || hasActiveAccount) &&
      syncedForRef.current !== channel.id &&
      !syncMut.isPending
    ) {
      syncedForRef.current = channel.id;
      syncMut.mutate({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, hasActiveAccount]);

  // Открытие треда лички = момент «сейчас напишу» → освежаем цену сообщения
  // force-sync'ом (outgoing_paid_message_star_count мог измениться после скана:
  // личка стала платной/бесплатной). Один sync на открытие; сбрасываем на закрытие.
  const dmSyncedRef = useRef(false);
  useEffect(() => {
    if (dmOpen && !dmSyncedRef.current && hasActiveAccount && !syncMut.isPending) {
      dmSyncedRef.current = true;
      syncMut.mutate({ force: true });
    }
    if (!dmOpen) dmSyncedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmOpen, hasActiveAccount]);

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
  // Закрытый MAX-канал без членства — sync ставит meta.mx_pending; показываем
  // кнопку «Вступить» вместо ленты (постов без вступления нет).
  const maxPending =
    channel.platform === "max" &&
    (channel.meta as Record<string, unknown> | null)?.mx_pending === true;

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
      <ChannelHero channel={channel} syncing={syncMut.isPending} compact={compact} />
      {/* Баннер синка — только пока профиль пустой (подписчиков ещё нет).
          Как только данные есть, фоновый ре-синк идёт тихо: метрики/лента уже
          показаны, баннер не висит «вечно». */}
      {syncMut.isPending && channel.memberCount == null && (
        <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-5 py-2 text-xs text-zinc-500">
          <Loader2 size={13} className="animate-spin" />
          Подтягиваем профиль канала…
        </div>
      )}
      {!compact && (
        <MetaBadges
          channel={channel}
          propertyDefs={propertyDefsQ.data ?? []}
          onDmClick={hasDmGroup ? () => setDmOpen((v) => !v) : undefined}
        />
      )}
      {!compact && (propertyDefsQ.data?.length ?? 0) > 0 && (
        <ChannelPropertiesSection
          defs={propertyDefsQ.data!}
          values={channel.properties as Record<string, unknown>}
          onSave={(properties) => patchMut.mutate({ properties })}
          saving={patchMut.isPending}
        />
      )}
      {!compact && <AdminsSection wsId={wsId} channel={channel} />}
      {!compact && channel.platform === "dzen" && <DzenContacts channel={channel} />}
      {!compact && dmOpen && hasDmGroup && (
        <ChannelDmSection
          wsId={wsId}
          channelId={channel.id}
          dmStarCost={dmStarCost}
          onClose={() => setDmOpen(false)}
        />
      )}
      {/* Лента: TG — посты через TDLib; YouTube/TikTok — это НЕ телеграмная
          сущность (с TG связан только контакт-админ), поэтому /history-фид тут
          не применим. Показываем провайдер-блок (метрики выше + ссылка). */}
      {isProviderPlatform ? (
        <ProviderFeed channel={channel} syncing={syncMut.isPending} />
      ) : maxPending ? (
        <MaxJoinPrompt wsId={wsId} channelId={channel.id} />
      ) : (
        <PostsFeed
          wsId={wsId}
          channelId={channel.id}
          platform={channel.platform}
          channelExternalId={channel.externalId}
          syncing={syncMut.isPending}
          syncFailed={syncFailed}
          unavailable={inUnavailableCooldown}
          hasActiveAccount={hasActiveAccount}
        />
      )}
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

function ChannelHero(props: {
  channel: Channel;
  syncing: boolean;
  compact?: boolean;
}) {
  const { channel, compact } = props;
  const meta = channel.meta as Record<string, unknown>;
  // TG пишет is_verified, провайдеры (YT/TikTok) — verified.
  const isVerified = meta?.is_verified === true || meta?.verified === true;
  const platform = PLATFORMS[channel.platform];
  const boostLevel =
    typeof meta?.boost_level === "number" ? meta.boost_level : 0;
  const createdAtTg =
    typeof meta?.created_at_tg === "number" ? meta.created_at_tg : null;
  // Авто-метрики из ленты (этап 16.10), пишутся на скане в meta.
  const avgReach = typeof meta?.avg_reach === "number" ? meta.avg_reach : null;
  const err = typeof meta?.err === "number" ? meta.err : null;
  const avatar = compact ? "h-11 w-11" : "h-16 w-16";

  return (
    <header
      className={
        "border-b border-zinc-100 " +
        (compact ? "px-5 pb-3 pt-4" : "px-6 pb-5 pt-6")
      }
    >
      <div className={"flex items-start " + (compact ? "gap-3" : "gap-4")}>
        {channel.thumbnailB64 ? (
          <img
            src={`data:image/jpeg;base64,${channel.thumbnailB64}`}
            alt=""
            className={`${avatar} shrink-0 rounded-full object-cover ring-1 ring-zinc-200 blur-[1.5px]`}
          />
        ) : typeof meta?.avatarUrl === "string" ? (
          // YouTube/TikTok: аватар — прямая ссылка на CDN площадки (не байты).
          <img
            src={meta.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className={`${avatar} shrink-0 rounded-full object-cover ring-1 ring-zinc-200`}
          />
        ) : (
          <div
            className={
              `flex ${avatar} shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 text-base font-semibold text-zinc-500` +
              (props.syncing ? " animate-pulse" : "")
            }
          >
            {channel.title.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          <h2
            className={
              "flex items-center gap-1.5 font-semibold leading-tight tracking-tight text-zinc-900 " +
              (compact ? "text-base" : "text-lg")
            }
          >
            <span className="truncate">{channel.title}</span>
            <platform.Icon
              size={15}
              className={`shrink-0 ${platform.color}`}
              aria-label={platform.label}
            />
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
              href={platform.url(channel.username)}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-emerald-700"
            >
              <span>@{channel.username}</span>
              <LinkIcon size={11} className="opacity-60" />
            </a>
          )}
          <div
            className={
              "flex items-baseline text-sm " +
              (compact ? "mt-2 gap-5" : "mt-3 gap-6")
            }
          >
            <Stat
              value={formatMembers(channel.memberCount)}
              label="подписчиков"
            />
            {avgReach !== null && (
              <Stat value={formatMembers(avgReach)} label="ср. охват" />
            )}
            {err !== null && <Stat value={`${err}%`} label="ERR" />}
            {!compact && createdAtTg && (
              <Stat value={formatAge(createdAtTg)} label="возраст" />
            )}
            {!compact && boostLevel > 0 && (
              <Stat value={`★ ${boostLevel}`} label="boost" tone="amber" />
            )}
          </div>
        </div>
      </div>
      {channel.description &&
        (compact ? (
          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-zinc-600">
            {channel.description.replace(/\n{2,}/g, "\n").trim()}
          </p>
        ) : (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
            {channel.description}
          </p>
        ))}
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

function MetaBadges({
  channel,
  propertyDefs,
  onDmClick,
}: {
  channel: Channel;
  propertyDefs: FieldDef[];
  onDmClick?: () => void;
}) {
  const meta = channel.meta as Record<string, unknown>;
  const values = channel.properties as Record<string, unknown>;
  // Личка канала: 0 → бесплатно (готовый контакт), >0 → вручную, null → не синкали.
  const { hasDm: hasDmGroup, starCost: dmStarCost } = channelDm(meta);
  const hasLinkedChat = meta?.has_linked_chat === true;
  const giftCount =
    typeof meta?.gift_count === "number" ? meta.gift_count : 0;
  const isBroadcastGroup = meta?.is_broadcast_group === true;

  // Кастом-поля канала: показываем заполненные, с лейблом из каталога и
  // человекочитаемым значением (для select — имя опции, не id). Идём по
  // порядку каталога, а не по сырым ключам — orphan-ключи не светятся.
  const customBadges = propertyDefs
    .map((def) => ({ def, text: displayPropertyValue(def, values[def.key]) }))
    .filter((x) => x.text !== null);

  const badges: {
    key: string;
    node: React.ReactNode;
    onClick?: () => void;
  }[] = [];
  if (hasDmGroup) {
    badges.push({
      key: "dm",
      onClick: onDmClick,
      node:
        dmStarCost === 0 ? (
          <Badge tone="emerald" icon={Send}>
            Можно в личку
          </Badge>
        ) : dmStarCost != null && dmStarCost > 0 ? (
          <Badge tone="amber" icon={Send}>
            В личку: {dmStarCost}⭐/сообщ
          </Badge>
        ) : (
          <Badge tone="zinc" icon={Send}>
            Личка канала
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
  for (const { def, text } of customBadges) {
    badges.push({
      key: `prop:${def.key}`,
      node: (
        <Badge tone="zinc">
          <span className="text-zinc-500">{def.name}</span>{" "}
          <span className="font-semibold text-zinc-800">{text}</span>
        </Badge>
      ),
    });
  }

  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-6 py-3">
      {badges.map((b) =>
        b.onClick ? (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            title="Открыть личку канала"
            className="rounded-full transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {b.node}
          </button>
        ) : (
          <span key={b.key}>{b.node}</span>
        ),
      )}
    </div>
  );
}

// Человекочитаемое значение кастом-поля для бейджа. null = поле пустое (не
// показываем). Для select'ов разворачиваем option.id → option.name.
function displayPropertyValue(def: FieldDef, raw: unknown): string | null {
  if (def.type === "multi_select") {
    const ids = Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) return null;
    return ids
      .map((id) => def.values?.find((v) => v.id === id)?.name ?? id)
      .join(", ");
  }
  if (def.type === "single_select") {
    if (typeof raw !== "string" || raw === "") return null;
    return def.values?.find((v) => v.id === raw)?.name ?? raw;
  }
  if (def.type === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : null;
  }
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

// Редактируемая секция кастом-полей канала (drawer). Тот же PropertyFields, что
// у контакта; сохраняем через PATCH /channels/{id} { properties }. Кнопка
// «Сохранить» — только при наличии правок (CLAUDE.md §6).
function ChannelPropertiesSection(props: {
  defs: FieldDef[];
  values: Record<string, unknown>;
  onSave: (properties: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const { defs, values, onSave } = props;
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
    ...values,
  }));
  // Сервер-данные обновились (после save / внешнего sync) → синхронизируем
  // черновик. JSON-ключ в deps, чтобы реагировать на смену значений, а не
  // идентичности объекта.
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    setDraft({ ...values });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey]);

  // dirty — только по ключам каталога (orphan-ключи в values не считаем).
  const dirty = defs.some((d) => {
    const a = draft[d.key];
    const b = values[d.key];
    return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
  });

  return (
    <div className="border-b border-zinc-100 px-6 py-3">
      <PropertyFields fields={defs} values={draft} onChange={setDraft} />
      {dirty && (
        <button
          type="button"
          onClick={() => onSave(draft)}
          disabled={props.saving}
          className="mt-3 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {props.saving ? "Сохраняем…" : "Сохранить"}
        </button>
      )}
    </div>
  );
}

// Тред лички канала в карточке (этап 16.9): открывается по DM-бейджу. Пишем
// прямо из каталога — без привязки к кампании (ручка method-* резолвит chat_id
// из meta.direct_messages_chat_id и берёт любой активный аккаунт). Платная
// личка — read-only (звёзды тратятся вручную в Telegram).
function ChannelDmSection(props: {
  wsId: string;
  channelId: string;
  dmStarCost: number | null;
  onClose: () => void;
}) {
  const paid = props.dmStarCost != null && props.dmStarCost > 0;
  return (
    <div className="flex h-80 shrink-0 flex-col border-b border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2">
        <span className="text-xs font-semibold text-zinc-700">
          Личка канала
          {paid ? ` · ${props.dmStarCost}⭐/сообщ` : " · бесплатно"}
        </span>
        <button
          type="button"
          onClick={props.onClose}
          className="text-xs text-zinc-400 hover:text-zinc-600"
        >
          Свернуть
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <MethodChatPanel
          wsId={props.wsId}
          channelId={props.channelId}
          target="dm"
          starCost={props.dmStarCost}
        />
      </div>
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
    mutationFn: async (body: { contactIds?: string[]; usernames?: string[] }) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/admins",
        {
          params: { path: { wsId: props.wsId, id: props.channel.id } },
          body,
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

  // MAX-админ: ссылка max.ru/u/<token> идёт через set-admin (создаст контакт с
  // max_link, заменит админа и перенаведёт размещения) — у /admins нет maxLink.
  const setMaxAdminMut = useMutation({
    mutationFn: async (maxLink: string) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/set-admin",
        {
          params: { path: { wsId: props.wsId, id: props.channel.id } },
          body: { maxLink },
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
                  className="truncate text-zinc-800 hover:text-emerald-700"
                  title={
                    a.telegramUsername && a.fullName
                      ? `@${a.telegramUsername}`
                      : undefined
                  }
                >
                  {label}
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
          onPick={(contactId) => addMut.mutate({ contactIds: [contactId] })}
          onCreateByUsername={(input) =>
            /max\.ru\/u\//i.test(input)
              ? setMaxAdminMut.mutate(input)
              : addMut.mutate({ usernames: [input] })
          }
          onCancel={() => setAdding(false)}
          loading={addMut.isPending || setMaxAdminMut.isPending}
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

// Подписка как fallback для приватных каналов: бэк отдал 412 «subscription
// required», показываем плашку. Один аккаунт — кнопка работает сразу; несколько
// — выбор. Подписка идёт через свой аккаунт (write — только владелец).
function SubscribePrompt(props: { wsId: string; channelId: string }) {
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(props.wsId);
  const myActive = (accountsQ.data ?? []).filter((a) => a.status === "active");

  const subscribeMut = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/subscribe",
        {
          params: { path: { wsId: props.wsId, id: props.channelId } },
          body: { accountId },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["channel-history", props.wsId, props.channelId],
      });
    },
  });

  if (myActive.length === 0) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Чтобы читать переписку приватного канала, нужен подписанный
          Telegram-аккаунт. Подключите аккаунт в разделе{" "}
          <strong>Telegram-аккаунты</strong>.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 px-6 py-4">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        Подпишитесь, чтобы читать приватный канал.
        <div className="mt-2 flex flex-wrap gap-1.5">
          {myActive.map((a) => {
            const label =
              a.firstName ||
              (a.tgUsername ? `@${a.tgUsername}` : a.phoneNumber) ||
              a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => subscribeMut.mutate(a.id)}
                disabled={subscribeMut.isPending}
                className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {myActive.length === 1
                  ? subscribeMut.isPending
                    ? "Подписываемся…"
                    : "Подписаться"
                  : subscribeMut.isPending
                    ? "…"
                    : `Подписать ${label}`}
              </button>
            );
          })}
        </div>
        {subscribeMut.error && (
          <p className="mt-2 text-xs text-red-600">
            {errorMessage(subscribeMut.error)}
          </p>
        )}
      </div>
    </div>
  );
}

export type ChannelMessage = {
  id: string;
  date: string;
  text: string;
  entities: MessageEntity[];
  mediaThumb: MessageThumb | null;
  // full-res дескриптор (есть только в /history). Опционально — /preview его не
  // отдаёт, там остаётся блюр-thumb.
  media?: { kind: "photo" | "video"; width: number; height: number } | null;
  // Прямой CDN-URL медиа (MAX). null/undefined → рендер через TG-прокси/thumb.
  mediaUrl?: string | null;
  views: number | null;
  forwards: number | null;
  replies: number | null;
  reactions: { emoji: string; count: number }[];
  isForwarded: boolean;
};

type ProviderVideo = {
  id: string;
  url: string;
  title: string | null;
  coverUrl: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null;
  durationSec: number | null;
};

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return (h > 0 ? `${h}:` : "") + `${mm}:${String(s).padStart(2, "0")}`;
}

// Лента провайдер-канала (YouTube/TikTok): сетка последних видео (обложка +
// подпись, клик → площадка) + чип тематики. С Telegram не связано — у провайдера
// телеграмный только контакт-админ.
// Контакты/соцсети/РКН/Premium Дзена (meta.dz). Дзен, в отличие от YT/TikTok,
// отдаёт это в том же одном запросе профиля — показываем как пищу для outreach.
type DzenMeta = {
  emails?: string[];
  phones?: string[];
  social_links?: { net: string | null; name: string | null; link: string | null }[];
  donations_enabled?: boolean;
  rkn?: { link: string } | null;
  premium_tariffs?: { name: string | null; price_rub: number | null; period: string | null }[];
};

function DzenContacts({ channel }: { channel: Channel }) {
  const dz = ((channel.meta ?? {}) as Record<string, unknown>).dz as
    | DzenMeta
    | undefined;
  if (!dz) return null;
  const emails = dz.emails ?? [];
  const phones = dz.phones ?? [];
  const socials = (dz.social_links ?? []).filter((s) => s.link);
  const tariffs = (dz.premium_tariffs ?? []).filter((t) => t.price_rub != null);
  const hasAny =
    emails.length || phones.length || socials.length || dz.rkn || tariffs.length;
  if (!hasAny) return null;

  return (
    <div className="space-y-2.5 border-b border-zinc-100 px-6 py-3 text-sm">
      {(emails.length > 0 || phones.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {emails.map((e) => (
            <a
              key={e}
              href={`mailto:${e}`}
              className="inline-flex items-center gap-1.5 text-zinc-700 hover:text-emerald-700"
            >
              <Mail size={13} className="text-zinc-400" />
              {e}
            </a>
          ))}
          {phones.map((p) => (
            <a
              key={p}
              href={`tel:${p}`}
              className="inline-flex items-center gap-1.5 text-zinc-700 hover:text-emerald-700"
            >
              <Phone size={13} className="text-zinc-400" />
              {p}
            </a>
          ))}
        </div>
      )}
      {socials.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {socials.map((s, i) => (
            <a
              key={`${s.net ?? ""}-${s.link}-${i}`}
              href={s.link!}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200"
            >
              {s.name ?? s.net}
              <LinkIcon size={10} className="opacity-50" />
            </a>
          ))}
        </div>
      )}
      {(dz.rkn || dz.donations_enabled) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          {dz.rkn && (
            <a
              href={dz.rkn.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-zinc-600 hover:text-emerald-700"
            >
              <ShieldCheck size={13} className="text-zinc-400" />
              В реестре блогеров РКН
            </a>
          )}
          {dz.donations_enabled && <span>Донаты включены</span>}
        </div>
      )}
      {tariffs.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
            <CreditCard size={13} className="text-zinc-400" />
            Платная подписка
          </div>
          <ul className="space-y-0.5 pl-5 text-xs text-zinc-600">
            {tariffs.map((t, i) => (
              <li key={i} className="list-disc">
                <span className="font-medium text-zinc-800">{t.price_rub} ₽</span>
                {t.period ? `/${t.period}` : ""} — {t.name ?? "тариф"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProviderFeed({
  channel,
  syncing,
}: {
  channel: Channel;
  syncing: boolean;
}) {
  const platform = PLATFORMS[channel.platform];
  const meta = (channel.meta ?? {}) as Record<string, unknown>;
  const url =
    channel.link ?? (channel.username ? platform.url(channel.username) : null);
  const topics = Array.isArray(meta.topics) ? (meta.topics as string[]) : [];
  const videos = Array.isArray(meta.recent_videos)
    ? (meta.recent_videos as ProviderVideo[])
    : [];

  if (syncing && videos.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-6 py-10 text-sm text-zinc-400">
        <Loader2 size={14} className="animate-spin" />
        Подтягиваем видео канала…
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {topics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-6 py-3">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">
            Тематика
          </span>
          {topics.map((t) => (
            <span
              key={t}
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {videos.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-zinc-400">
          Видео не подтянулись.{" "}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-600 hover:underline"
            >
              Открыть на {platform.label} ↗
            </a>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-6 py-4">
          {videos.map((v) => (
            <ProviderVideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderVideoCard({ video: v }: { video: ProviderVideo }) {
  return (
    <a
      href={v.url}
      target="_blank"
      rel="noreferrer"
      className="group block overflow-hidden rounded-lg ring-1 ring-zinc-200 transition hover:ring-emerald-300"
    >
      <div className="relative aspect-video bg-zinc-100">
        {v.coverUrl && (
          <img
            src={v.coverUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        )}
        {v.durationSec != null && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
            {fmtDuration(v.durationSec)}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="line-clamp-2 text-xs leading-snug text-zinc-700">
          {v.title ?? "—"}
        </p>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] tabular-nums text-zinc-400">
          {v.views != null && <span>👁 {formatCompact(v.views)}</span>}
          {v.likes != null && <span>❤ {formatCompact(v.likes)}</span>}
          {v.comments != null && <span>💬 {formatCompact(v.comments)}</span>}
        </div>
      </div>
    </a>
  );
}

// Кнопка вступления в закрытый MAX-канал. Часть пускает сразу → посты/охваты
// подтянутся; часть по одобрению админа → «запрос отправлен».
function MaxJoinPrompt({
  wsId,
  channelId,
}: {
  wsId: string;
  channelId: string;
}) {
  const qc = useQueryClient();
  const joinMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/max-subscribe",
        { params: { path: { wsId, id: channelId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channel", wsId, channelId] });
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
    },
  });
  return (
    <div className="min-h-0 flex-1 px-6 py-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
        Закрытый MAX-канал — чтобы видеть посты и охваты, нужно вступить.
        <div className="mt-2">
          <button
            type="button"
            onClick={() => joinMut.mutate()}
            disabled={joinMut.isPending}
            className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {joinMut.isPending ? "Вступаем…" : "Вступить в канал"}
          </button>
        </div>
        {joinMut.error && (
          <p className="mt-2 text-xs text-red-600">
            {errorMessage(joinMut.error)}
          </p>
        )}
        {joinMut.isSuccess && (
          <p className="mt-2 text-xs text-violet-700">
            Если канал по одобрению — запрос отправлен; иначе посты уже
            подтянулись.
          </p>
        )}
      </div>
    </div>
  );
}

function PostsFeed(props: {
  wsId: string;
  channelId: string;
  platform: Platform;
  channelExternalId: string | null;
  syncing: boolean;
  syncFailed: boolean;
  // Канал помечен недоступным и кулдаун ещё не истёк. /history всё равно
  // вернёт 410, поэтому не дёргаем — UI поверх показывает persistedReason.
  unavailable: boolean;
  // Есть ли в воркспейсе хоть один active outreach-аккаунт. Без него
  // /history гарантированно вернёт 412 «нет аккаунта», поэтому не дёргаем.
  hasActiveAccount: boolean;
}) {
  const PAGE_LIMIT = 50;
  const enabled =
    !!props.channelExternalId &&
    !props.syncing &&
    !props.syncFailed &&
    !props.unavailable &&
    props.hasActiveAccount;

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
  // MAX: пагинации ленты пока нет (id сообщений > MAX_SAFE_INTEGER, бэк отдаёт
  // последние N). hasMore=false сразу — иначе onScroll шлёт overflow-id → 400.
  const [hasMore, setHasMore] = useState(props.platform !== "max");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);
  const qc = useQueryClient();
  const metricsRefreshed = useRef(false);

  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
    setLoadMoreError(null);
    setLoadingMore(false);
    didAutoScrollRef.current = false;
    metricsRefreshed.current = false;
  }, [props.channelId]);

  // Лента (/history) пересчитала метрики канала на бэке (этап 16.10) →
  // обновляем объект канала, чтобы шапка/правый рельс показали свежие
  // ср.охват/ERR. Один раз на успешную загрузку, без петли (channelQ рефетчит,
  // initialQ из кэша).
  useEffect(() => {
    if (!initialQ.isSuccess || metricsRefreshed.current) return;
    metricsRefreshed.current = true;
    qc.invalidateQueries({
      queryKey: ["channel", props.wsId, props.channelId],
    });
  }, [initialQ.isSuccess, props.wsId, props.channelId, qc]);

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
          query: { limit: PAGE_LIMIT, fromMessageId: String(oldestId) },
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
  const platformLabel = PLATFORMS[props.platform].label;
  if (!props.hasActiveAccount) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Чтобы читать каналы — подключите {platformLabel}-аккаунт в разделе{" "}
          <strong>Аутрич-аккаунты</strong>.
        </div>
      </div>
    );
  }
  if (props.syncFailed) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Сначала нужна синхронизация с {platformLabel} (см. сообщение выше).
      </div>
    );
  }
  if (!props.channelExternalId) {
    return (
      <div className="min-h-0 flex-1 px-6 py-4 text-sm text-zinc-400">
        Нет привязки к {platformLabel} — история недоступна.
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
    if (msg.includes("subscription required")) {
      return (
        <SubscribePrompt
          wsId={props.wsId}
          channelId={props.channelId}
        />
      );
    }
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
          <Post
            key={m.id}
            m={m}
            wsId={props.wsId}
            channelId={props.channelId}
          />
        ))}
      </div>
    </div>
  );
}

export function Post({
  m,
  wsId,
  channelId,
}: {
  m: ChannelMessage;
  // Если переданы — медиа рендерится в full-res (лениво, поверх блюра). Без них
  // (preview-дровер) остаётся только блюр-thumb.
  wsId?: string;
  channelId?: string;
}) {
  const hasInteractions =
    m.views !== null ||
    m.forwards !== null ||
    m.replies !== null ||
    m.reactions.length > 0;
  const fullRes = m.media && wsId && channelId;
  return (
    <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200">
      {m.mediaUrl ? (
        // MAX: прямой CDN-URL (фото/постер видео). Видео не проигрываем —
        // показываем кадр с play-бейджем.
        <div className="relative bg-zinc-100">
          <img
            src={m.mediaUrl}
            alt=""
            loading="lazy"
            className="max-h-96 w-full object-contain"
            // CDN-URL может быть недоступен (referer-gate/протух) — прячем весь
            // блок, чтобы не висела битая иконка с play-бейджем поверх.
            onError={(e) => {
              e.currentTarget.parentElement?.style.setProperty("display", "none");
            }}
          />
          {m.media?.kind === "video" && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/50 p-3">
                <Play size={20} className="fill-white text-white" />
              </span>
            </span>
          )}
        </div>
      ) : fullRes ? (
        <FullResMedia
          src={`/v1/workspaces/${wsId}/channels/${channelId}/post-media/${m.id}`}
          thumb={m.mediaThumb}
          kind={m.media!.kind}
          width={m.media!.width}
          height={m.media!.height}
        />
      ) : (
        m.mediaThumb && <MessageMediaThumb thumb={m.mediaThumb} />
      )}
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
          <ReactionChips reactions={m.reactions} />
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

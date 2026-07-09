import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Send,
  Trash2,
  FileText,
  Image as ImageIcon,
  Hash,
  Eye,
  Check,
  Undo2,
  ExternalLink,
  Copy,
  RefreshCw,
} from "lucide-react";
import { computeDealPricing } from "@repo/core";
import { api, sendContactDocument } from "../../../../../lib/api";
import { errorMessage } from "../../../../../lib/errors";
import { copyText } from "../../../../../lib/clipboard";
import { formatPastRelative } from "../../../../../lib/date-utils";
import { useOutreachAccounts } from "../../../../../lib/outreach-queries";
import { LeadChatPanel } from "../../../../../components/lead-chat-drawer";
import { MethodChatPanel } from "../../../../../components/method-chat-panel";
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
import { ChannelFeedDrawer } from "../../../../../components/channel-feed-drawer";
import { ContactResolver } from "../../../../../components/contact-resolver";
import { RKN_THRESHOLD } from "../../../../../components/channel-badges";
import {
  formatRub,
  formatViews,
  cpv,
  type Placement,
  type ContractStatus,
  type CreativeStatus,
} from "./-shared";
import { deriveProduction, PROD_OWNER } from "./-ui";

// Черновик сделки: всё про деньги блогера живёт на размещении (не на контакте,
// не на канале). Прогнозы (охват/ERR) берём из канала, «готов» — кнопки решения.
//   priceAmount      — сумма блогеру чистыми (W)
//   surchargePercent — «% сверху» (надбавка блогера, не важно налог/комиссия)
//   bloggerVat       — эта надбавка есть зачётный НДС
//   format           — формат под цену (1/24 …)
//   quotedRates      — весь прайс блогера как ответил (free text)
type Draft = {
  priceAmount: string;
  surchargePercent: string;
  bloggerVat: boolean;
  format: string;
  quotedRates: string;
  createShare: string;
};

function toDraft(p: Placement): Draft {
  return {
    priceAmount: p.priceAmount?.toString() ?? "",
    surchargePercent: p.surchargePercent?.toString() ?? "",
    bloggerVat: p.bloggerVat,
    format: p.format ?? "",
    quotedRates: p.quotedRates ?? "",
    createShare: p.createShare?.toString() ?? "",
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
  pricing: pricingSettings,
  siblings,
  onSelectPlacement,
  onRemoved,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  // Ценовые настройки кампании (срез 3/5): множители цепочки, едины на кампанию.
  pricing: {
    akPercent: number;
    vat: boolean;
    vatRate: number;
    ord3: boolean;
    split: boolean;
  };
  // Размещения того же админа в кампании (Option A): чипы-переключатель над
  // общим чатом. <2 — чипы не показываем, переключать нечего.
  siblings: Placement[];
  onSelectPlacement: (id: string) => void;
  onRemoved: () => void;
}) {
  const qc = useQueryClient();
  const accountsQ = useOutreachAccounts(wsId);
  const [draft, setDraftRaw] = useState<Draft>(() => toDraft(placement));
  // Мерж-патч: колл-сайты правят по одному полю (setDraft({ priceAmount })).
  const setDraft = (patch: Partial<Draft>) =>
    setDraftRaw((d) => ({ ...d, ...patch }));
  const [changing, setChanging] = useState(false);
  // Превью канала — выезжает справа поверх (общий ChannelFeedDrawer: работает
  // для всех платформ). Постоянной карточки канала больше нет: место отдано
  // чату+сделке, канал — по клику на строку метрик.
  const [previewOpen, setPreviewOpen] = useState(false);
  // Расценки блогера — свёрнуты, если пусто; развёрнуты, если уже заполнены.
  const [ratesOpen, setRatesOpen] = useState(() => !!placement.quotedRates);
  // Форма отказа: раскрывается по «Отказ», спрашивает кто отказался + причину.
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineNote, setDeclineNote] = useState("");
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

  // Авто-подтягивание метрик при открытии строки лонглиста. Раньше ср.охват/ERR
  // наполнялись только когда менеджер открывал превью-дровер (ChannelCard →
  // PostsFeed → /history). Дёргаем тот же /history headless при монтировании
  // панели — ТОТ ЖЕ queryKey/queryFn, что у PostsFeed, поэтому последующее
  // открытие превью идёт из кэша, без второго TDLib-захода. Только не-provider
  // (у YouTube/TikTok/Dzen метрики пишет /sync, не /history), с активным
  // outreach-аккаунтом платформы, вне unavailable, и лишь пока метрик нет
  // (avgReach === null) — просканированные не тревожим (флуд убрали, этап 16.10).
  const chan = channelQ.data;
  const chanIsProvider =
    chan?.platform === "youtube" ||
    chan?.platform === "tiktok" ||
    chan?.platform === "dzen";
  const chanHasActiveAccount =
    !!chan &&
    !!accountsQ.data &&
    accountsQ.data.some(
      (a) => a.status === "active" && a.platform === chan.platform,
    );
  // Закрытый MAX-канал без членства: /history зовёт fetchMaxPosts на чат, где
  // аккаунт не состоит → пусто/ошибка. ChannelCard такой обходит (MaxJoinPrompt).
  const chanMaxPending =
    chan?.platform === "max" && cMeta.mx_pending === true;
  // 410 у /history — по кулдауну недоступности (unavailableLastCheckAt < 1ч),
  // не по факту unavailableReason. Зеркалим PostsFeed (channel-card.tsx).
  const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;
  const chanInCooldown =
    !!chan?.unavailableLastCheckAt &&
    Date.now() - new Date(chan.unavailableLastCheckAt).getTime() <
      UNAVAILABLE_COOLDOWN_MS;
  const historyQ = useQuery({
    queryKey: ["channel-history", wsId, channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/history",
        {
          params: { path: { wsId, id: channelId! }, query: { limit: 50 } },
        },
      );
      if (error) throw error;
      return data!.messages;
    },
    enabled:
      !!channelId &&
      !!chan?.externalId &&
      !chanIsProvider &&
      !chanMaxPending &&
      chanHasActiveAccount &&
      !chanInCooldown &&
      avgReach === null,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  // Лента пересчитала метрики на бэке (meta.avg_reach/err) → перечитать channelQ,
  // чтобы строка метрик показала свежие цифры. Один раз на успех: панель
  // пересоздаётся по placement.id, поэтому ref свежий на каждый выбор канала.
  const metricsRefreshed = useRef(false);
  useEffect(() => {
    if (!historyQ.isSuccess || metricsRefreshed.current) return;
    metricsRefreshed.current = true;
    // И карточку канала (строка метрик), и список каналов — как PostsFeed:
    // у строки списка свой meta с avg_reach/err, без инвалидации останется старым.
    qc.invalidateQueries({ queryKey: ["channel", wsId, channelId] });
    qc.invalidateQueries({ queryKey: ["channels", wsId] });
  }, [historyQ.isSuccess, wsId, channelId, qc]);
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

  // Поля сделки для PATCH (цена + блок «блогеру») — общие для автосейва и
  // «Согласован», чтобы решение не теряло введённое.
  const dealBody = () => ({
    priceAmount: numOrNull(draft.priceAmount),
    surchargePercent: numOrNull(draft.surchargePercent),
    bloggerVat: draft.bloggerVat,
    format: draft.format.trim() || null,
    quotedRates: draft.quotedRates.trim() || null,
    createShare: numOrNull(draft.createShare),
  });

  // Автосейв полей сделки на blur (уход фокуса со всей строки).
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: dealBody(),
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
            ...dealBody(),
            available: true,
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
  // Фиксируем ПОЧЕМУ: кто отказался (блогер их решением / мы своим — цена, нет
  // дат, не подошёл) + деталь текстом. Причина уезжает в «Историю размещений»
  // канала → в следующей кампании видно, чем закончилось в прошлый раз.
  const decline = useMutation({
    mutationFn: async (arg: { by: "blogger" | "us"; note: string }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
        {
          params: { path: { wsId, projectId, placementId: placement.id } },
          body: {
            available: false,
            declineBy: arg.by,
            declineNote: arg.note.trim() || null,
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

  // Кнопка «Сохранить» — только при наличии изменений (CLAUDE.md §6).
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(placement));

  // Гейт «Согласован»: в шортлист (→ клиентский вид) нельзя без цены, формата и
  // налоговой инфы блогера (% сверху/НДС). Иначе клиент согласует 0 ₽ без
  // наценки, как и случилось. «% сверху» = 0 валиден, но должен быть введён
  // явно (не null) — значит менеджер спросил блогера, а не забыл.
  const agreeMissing: string[] = [];
  if ((numOrNull(draft.priceAmount) ?? 0) <= 0) agreeMissing.push("цену");
  if (!draft.format.trim()) agreeMissing.push("формат");
  if (numOrNull(draft.surchargePercent) === null)
    agreeMissing.push(draft.bloggerVat ? "НДС %" : "% сверху");
  const agreeReady = agreeMissing.length === 0;

  // Живой показ цены клиенту (не персистим): множители — из настроек кампании,
  // блок «блогеру» — из черновика размещения, прогноз — снапшот или авто-охват
  // канала. CPV по базе до НДС.
  const bloggerCost = numOrNull(draft.priceAmount) ?? 0;
  // Доля создания при сплите (срез 5): вход в % создания, движок сам делит.
  const createShareNum = numOrNull(draft.createShare);
  const pricing = computeDealPricing({
    cost: bloggerCost,
    surchargePercent: numOrNull(draft.surchargePercent) ?? 0,
    bloggerVat: draft.bloggerVat,
    akPercent: pricingSettings.akPercent,
    vat: pricingSettings.vat,
    vatRate: pricingSettings.vatRate,
    ord3: pricingSettings.ord3,
    splitEnabled: pricingSettings.split,
    createShare: createShareNum,
    forecastViews: placement.forecastViews ?? avgReach,
  });

  return (
    <div className="flex h-full flex-col">
      {siblings.length >= 2 && (
        <SiblingChips
          siblings={siblings}
          activeId={placement.id}
          onSelect={onSelectPlacement}
        />
      )}
      <div className="flex min-h-0 flex-1">
      {/* Две колонки: центр — вся инфо по размещению (сделка, вертикальный
          столбец), право — чат во всю высоту. Канал не занимает постоянного
          места: метрики кликабельны → превью выезжает справа поверх. Резолвер
          (на всю ширину) — если способ связи ещё не выбран. */}
        {hasMethod && !changing ? (
          <>
            <div className="flex w-96 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-white">
            <div
              onBlur={(e) => {
                // Сохраняем, только когда фокус ушёл со всей строки.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dirty && !save.isPending) save.mutate();
              }}
              className="px-4 py-3"
            >
              {isBot && (
                <div className="mb-2 rounded-md bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600">
                  Бот — авторассылка сюда не идёт, напишите вручную в чате ниже.
                </div>
              )}
              {channelId && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  title="Открыть превью канала — лента постов и охваты"
                  className="mb-2 flex w-full items-baseline gap-3 rounded-md px-1 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
                >
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
                  {avgReach === null && historyQ.isFetching && (
                    <span className="text-zinc-400">подтягиваем охваты…</span>
                  )}
                  {placement.channel?.memberCount != null && (
                    <span>
                      <b className="text-zinc-700">
                        {formatViews(placement.channel.memberCount)}
                      </b>{" "}
                      подп.
                    </span>
                  )}
                  {placement.channel &&
                    !placement.channel.isRkn &&
                    placement.channel.memberCount != null &&
                    placement.channel.memberCount > RKN_THRESHOLD && (
                      <span className="font-medium text-red-600">не в РКН</span>
                    )}
                  <span className="ml-auto inline-flex items-center gap-1 text-emerald-700">
                    <Eye size={13} /> канал
                  </span>
                </button>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <BarField label="Цена ₽">
                  <BarNum
                    value={draft.priceAmount}
                    onChange={(v) => setDraft({ priceAmount: v })}
                  />
                </BarField>
                <BarField label="Формат">
                  <input
                    value={draft.format}
                    placeholder="1/24"
                    maxLength={200}
                    onChange={(e) => setDraft({ format: e.target.value })}
                    className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </BarField>
                <BarField label={draft.bloggerVat ? "НДС %" : "% сверху"}>
                  <div className="flex items-center gap-1.5">
                    <input
                      inputMode="numeric"
                      value={draft.surchargePercent}
                      placeholder="0"
                      onChange={(e) =>
                        setDraft({ surchargePercent: e.target.value })
                      }
                      className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none"
                    />
                    <label
                      className="inline-flex items-center gap-1 text-xs text-zinc-600"
                      title="Надбавка — это зачётный НДС блогера"
                    >
                      <input
                        type="checkbox"
                        checked={draft.bloggerVat}
                        onChange={(e) =>
                          setDraft({ bloggerVat: e.target.checked })
                        }
                      />
                      НДС
                    </label>
                  </div>
                </BarField>
                {pricingSettings.split && (
                  <BarField label="Создание %">
                    <input
                      inputMode="numeric"
                      value={draft.createShare}
                      placeholder="0"
                      title="Доля создания контента — без ОРД. Остальное — размещение, на него +3%."
                      onChange={(e) =>
                        setDraft({ createShare: e.target.value })
                      }
                      className="w-12 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm focus:border-emerald-500 focus:outline-none"
                    />
                  </BarField>
                )}
                <SaveHint pending={save.isPending} error={save.error} />
              </div>
              {bloggerCost > 0 && (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                  {Math.round(pricing.payout) !== Math.round(bloggerCost) && (
                    <span>
                      Блогеру{" "}
                      <b className="text-zinc-700">
                        {formatRub(pricing.payout)}
                      </b>
                    </span>
                  )}
                  {pricingSettings.split && createShareNum != null && (
                    <span className="text-zinc-400">
                      созд.{" "}
                      <b className="text-zinc-600">
                        {formatRub(pricing.createPart)}
                      </b>{" "}
                      · разм.{" "}
                      <b className="text-zinc-600">
                        {formatRub(pricing.placePart)}
                      </b>
                    </span>
                  )}
                  <span>
                    Клиенту{" "}
                    <b className="text-zinc-700">
                      {formatRub(pricing.clientVat)}
                    </b>
                    {pricingSettings.vat && " с НДС"}
                  </span>
                  {pricingSettings.vat && (
                    <span className="text-zinc-400">
                      {formatRub(pricing.clientNoVat)} до НДС
                    </span>
                  )}
                  {pricing.cpv !== null && (
                    <span>
                      CPV{" "}
                      <b className="text-zinc-700">
                        {cpv(
                          pricing.clientNoVat,
                          placement.forecastViews ?? avgReach,
                        )}
                      </b>
                    </span>
                  )}
                </div>
              )}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setRatesOpen((o) => !o)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-700"
                >
                  {ratesOpen ? "скрыть расценки ▴" : "расценки блогера ▾"}
                  {!ratesOpen && draft.quotedRates.trim() ? " ·" : ""}
                </button>
                {ratesOpen && (
                  <textarea
                    value={draft.quotedRates}
                    placeholder="Весь прайс блогера как ответил…"
                    maxLength={4000}
                    onChange={(e) => setDraft({ quotedRates: e.target.value })}
                    rows={2}
                    className="mt-1 w-full resize-none rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                  />
                )}
              </div>
              {channelId && (
                <PlacementHistory
                  wsId={wsId}
                  channelId={channelId}
                  excludeId={placement.id}
                  onApply={(patch) => setDraft(patch)}
                />
              )}
              <div className="mt-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => agree.mutate()}
                    disabled={agree.isPending || !agreeReady}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    title={
                      agreeReady
                        ? "Блогер согласился — в шортлист"
                        : `Заполните: ${agreeMissing.join(", ")}`
                    }
                  >
                    <Check size={15} />
                    Согласован
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclineOpen((o) => !o)}
                    className={
                      "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 " +
                      (declineOpen
                        ? "border-red-300 bg-red-50 text-red-600"
                        : "border-zinc-300 text-zinc-600 hover:bg-red-50 hover:text-red-600")
                    }
                    title="Не сложилось — отметить, кто отказался"
                  >
                    <X size={15} />
                    Отказ
                  </button>
                  {/* Мусорка — не решение по переговорам, а «убрал по ошибке /
                      не рассматриваем». Отделяем разделителем, чтобы не читалась
                      как ещё один способ «отказать». */}
                  <div className="ml-auto flex items-center gap-2">
                    <span className="h-5 w-px bg-zinc-200" />
                    <RemovePlacementButton
                      wsId={wsId}
                      projectId={projectId}
                      placementId={placement.id}
                      onRemoved={onRemoved}
                    />
                  </div>
                </div>
                {!agreeReady && (
                  <p className="mt-1.5 text-[11px] text-amber-600">
                    Для согласования заполните: {agreeMissing.join(", ")}.
                  </p>
                )}
                {declineOpen && (
                  <div className="mt-2 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5">
                    <textarea
                      value={declineNote}
                      onChange={(e) => setDeclineNote(e.target.value)}
                      placeholder="Причина (необязательно): дорого, нет свободных дат, накрутка, не ответил…"
                      maxLength={2000}
                      rows={2}
                      className="w-full resize-none rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-red-400 focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-zinc-500">
                        Кто отказался?
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          decline.mutate({ by: "blogger", note: declineNote })
                        }
                        disabled={decline.isPending}
                        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        Блогер
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          decline.mutate({ by: "us", note: declineNote })
                        }
                        disabled={decline.isPending}
                        className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        Мы
                      </button>
                    </div>
                    {decline.error && (
                      <p className="text-[11px] text-red-600">
                        {errorMessage(decline.error)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
            </div>
            {/* Право: чат во всю высоту. */}
            <div className="flex min-w-0 flex-1 flex-col bg-white">
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
            </div>
          </>
        ) : (
          // Способ связи ещё не выбран (или «сменить»): слева — превью канала
          // (метрики + лента постов), справа — резолвер контакта. Раньше был
          // дедлок: чтобы назначить админа, надо судить о канале, а превью на
          // этом этапе не показывали. Паттерн из BD-режима (LeadPrepPane).
          <div className="flex min-h-0 flex-1 bg-white">
            <div className="min-w-0 flex-1 overflow-hidden border-r border-zinc-200">
              {channelQ.data ? (
                <ChannelCard wsId={wsId} channel={channelQ.data} compact />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-400">
                  {channelQ.isLoading ? "Загрузка канала…" : "Канал недоступен"}
                </div>
              )}
            </div>
            <div className="flex w-[360px] shrink-0 flex-col">
              <ContactResolver
                wsId={wsId}
                channelId={channelId}
                channel={channelQ.data ?? null}
                onResolved={invalidate}
                onClose={hasMethod ? () => setChanging(false) : undefined}
                headerAction={
                  <RemovePlacementButton
                    wsId={wsId}
                    projectId={projectId}
                    placementId={placement.id}
                    onRemoved={onRemoved}
                    className="shrink-0"
                  />
                }
              />
            </div>
          </div>
        )}
      </div>
      {previewOpen && channelId && (
        <ChannelFeedDrawer
          wsId={wsId}
          channelId={channelId}
          title={placement.channel?.title ?? "Канал"}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}

// Чипы-переключатель размещений одного админа (Option A): общий чат ведётся с
// админом, а размещений у него в кампании может быть несколько. Показываем
// только при ≥2 — иначе переключать нечего. Клик по чипу переключает выбранную
// строку в родителе (панель пересоздаётся, чат тот же — контакт один).
// Переиспользуемо в ProductionPane тем же паттерном: onSelect → controlled
// selectedId у InboxShell (не тащить siblings в сам InboxShell — он generic).
function SiblingChips({
  siblings,
  activeId,
  onSelect,
}: {
  siblings: Placement[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-3 py-1.5">
      <span className="mr-1 shrink-0 text-[11px] text-zinc-400">
        Диалог по {siblings.length} размещениям:
      </span>
      {siblings.map((s) => {
        const active = s.id === activeId;
        const label = s.channel?.username
          ? `@${s.channel.username}`
          : (s.channel?.title ?? "канал");
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            title={s.channel?.title ?? undefined}
            className={
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium " +
              (active
                ? "bg-emerald-600 text-white"
                : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100")
            }
          >
            {label}
            {s.chainStatus === "declined" ? " ✗" : ""}
          </button>
        );
      })}
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

// История размещений канала (срез 4): прошлые сделки по этому каналу через все
// кампании (агрегат project_items, не отдельная сущность). Кнопка «подставить»
// тянет условия последнего размещения (цена + формат + надбавка/НДС) в черновик
// — наследование вперёд без отдельной сущности. Пусто → ничего не рисуем
// (первый выход блогера — истории нет).
function PlacementHistory({
  wsId,
  channelId,
  excludeId,
  onApply,
}: {
  wsId: string;
  channelId: string;
  excludeId: string;
  onApply: (patch: Partial<Draft>) => void;
}) {
  const q = useQuery({
    queryKey: ["placement-history", wsId, channelId, excludeId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/placement-history",
        { params: { path: { wsId, id: channelId }, query: { excludeId } } },
      );
      if (error) throw error;
      return data.items;
    },
    staleTime: 60 * 1000,
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  const last = items[0]!;
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("ru-RU", {
      month: "short",
      year: "2-digit",
    });
  return (
    <div className="mt-2.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          История размещений
        </span>
        {last.priceAmount !== null && (
          <button
            type="button"
            onClick={() =>
              onApply({
                priceAmount: String(last.priceAmount),
                surchargePercent:
                  last.surchargePercent !== null
                    ? String(last.surchargePercent)
                    : "",
                bloggerVat: last.bloggerVat,
                format: last.format ?? "",
              })
            }
            className="text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
          >
            подставить →
          </button>
        )}
      </div>
      <div className="space-y-1">
        {items.map((h) => (
          <div key={h.placementId} className="text-[11px] text-zinc-600">
            <div className="flex justify-between gap-2">
              <span className="min-w-0 truncate">
                {h.campaignName} · {fmtDate(h.date)}
              </span>
              {h.declineBy ? (
                <span className="shrink-0 font-medium text-red-600">
                  ✗ {h.declineBy === "blogger" ? "блогер отказался" : "мы отказались"}
                </span>
              ) : (
                <span className="shrink-0 tabular-nums text-zinc-500">
                  {h.priceAmount !== null ? formatRub(h.priceAmount) : "—"}
                </span>
              )}
            </div>
            {h.declineNote && (
              <div className="truncate text-[10px] text-zinc-400">
                {h.declineNote}
              </div>
            )}
          </div>
        ))}
      </div>
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
  advertiserData,
}: {
  wsId: string;
  projectId: string;
  placement: Placement;
  // Реквизиты рекламодателя с кампании (бриф) — дефолт для ЕРИД-шага, если у
  // размещения свои не заданы.
  advertiserData: string | null;
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
  // Эффективные реквизиты рекламодателя для ЕРИД: своё на размещении (если
  // менеджер переопределил) иначе из брифа кампании.
  const eridAdv = draft.eridAdvertiserData || advertiserData || "";
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
      const text = `ERID: ${draft.erid}\nРекламодатель: ${eridAdv}\n\nНанесите «Реклама» + ERID в левый нижний угол креатива.`;
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
            eridAdvertiserData: eridAdv || null,
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
  // send-media, что и чат), менеджер пометит сообщение в чате после доставки.
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
      // Договор + акт вместе (запрос баера): акт/УПД подписывают сразу с
      // договором, иначе оплату не пропускают. Помечать сообщением в чате не
      // обязательно — по ЭДО бухгалтер сообщает вне переписки, поэтому кнопка
      // «подписан» / галочка «получен» доступны и без tag'а.
      key: "documents",
      icon: <FileText size={15} />,
      title: "Документы",
      done: draft.contractStatus === "signed" && draft.actReceived,
      summary: "Договор + акт подписаны",
      body: (
        <div className="space-y-3">
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Договор
            </div>
            {renderTagArea("contract")}
            {draft.contractStatus === "signed" ? (
              <p className="text-xs font-medium text-emerald-700">
                ✓ Договор подписан
              </p>
            ) : (
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
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Акт
            </div>
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
          <p className="text-[11px] text-zinc-400">
            Подписали по ЭДО — отметьте кнопкой/галочкой, сообщение в чате не
            обязательно.
          </p>
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
            placeholder={advertiserData || "данные рекла (ИНН + название)"}
            title={
              advertiserData
                ? "По умолчанию берётся из брифа кампании — впишите, чтобы переопределить"
                : undefined
            }
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
  ];
  // «Текущий» шаг для авто-раскрытия считаем по СОХРАНЁННОМУ состоянию, не по
  // live-черновику — иначе правка поля (напр. статус→«подписан») флипала бы done
  // и схлопывала редактируемый шаг до автосейва.
  const saved = toProd(placement);
  const doneServer = [
    saved.contractStatus === "signed" && saved.actReceived,
    saved.creativeStatus === "approved",
    !!saved.erid,
    !!placement.postUrl,
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
  const patchStatus = async (creativeStatus: CreativeStatus) => {
    const { error } = await api.PATCH(
      "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
      {
        params: { path: { wsId, projectId, placementId: placement.id } },
        body: { creativeStatus },
      },
    );
    if (error) throw error;
  };

  // Собрать на согласование / следующую итерацию: авто-создать (или
  // переиспользовать) Google-док и залить текущий текст креатива из TG. Статус →
  // client_review, счётчик итераций +1 (на бэке).
  const collect = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/collect",
        { params: { path: { wsId, projectId, placementId: placement.id } } },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // Зафиксировать: прочитать док, сдиффать с базлайном. Изменилось →
  // blogger_review (+ финалка блогеру); нет → approved.
  const freeze = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/creative-doc/freeze",
        { params: { path: { wsId, projectId, placementId: placement.id } } },
      );
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  // «Блогер ОК» → финализация; «Отозвать согласование» → назад к клиенту в док.
  const markApproved = useMutation({
    mutationFn: () => patchStatus("approved"),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: () => patchStatus("client_review"),
    onSuccess: invalidate,
  });

  // Отправка текста блогеру (quick-send, human-flow). Текст редактируемый.
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

  // T2: сообщить блогеру «согласовано» в один клик (human-flow quick-send).
  const notifyApproved = useMutation({
    mutationFn: async () => {
      if (!adminContactId || !sendAccountId) {
        throw new Error("Нет аккаунта или контакта для отправки");
      }
      const { error } = await api.POST("/v1/workspaces/{wsId}/quick-send", {
        params: { path: { wsId } },
        body: {
          accountId: sendAccountId,
          contactId: adminContactId,
          text: "Добрый день! Креатив согласовали — можно готовить публикацию по плану.",
        },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-history"] }),
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
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <Check size={14} /> Креатив согласован
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* T2: сообщить блогеру, что креатив согласован */}
            <button
              type="button"
              onClick={() => notifyApproved.mutate()}
              disabled={
                notifyApproved.isPending ||
                notifyApproved.isSuccess ||
                !adminContactId ||
                !sendAccountId
              }
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send size={12} />
              {notifyApproved.isSuccess
                ? "Блогеру сообщено"
                : notifyApproved.isPending
                  ? "Отправляем…"
                  : "Сообщить блогеру: согласовано"}
            </button>
            {/* T1: откат согласования — вернуть креатив к клиенту в док */}
            <button
              type="button"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Undo2 size={12} /> Отозвать согласование
            </button>
            {placement.creativeDocUrl && (
              <a
                href={placement.creativeDocUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                <ExternalLink size={12} /> Открыть док
              </a>
            )}
          </div>
          {(notifyApproved.error || revoke.error) && (
            <p className="text-[11px] text-red-600">
              {errorMessage(notifyApproved.error ?? revoke.error)}
            </p>
          )}
        </div>
      ) : status === "client_review" ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {placement.creativeDocUrl && (
              <>
                <a
                  href={placement.creativeDocUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  <ExternalLink size={12} /> Открыть док
                </a>
                <button
                  type="button"
                  onClick={() => copyText(placement.creativeDocUrl ?? "")}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
                >
                  <Copy size={12} /> Ссылку клиенту
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => freeze.mutate()}
              disabled={freeze.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check size={12} />
              {freeze.isPending ? "Читаем док…" : "Зафиксировать правки"}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Клиент правит в Google-доке. Когда закончит — «Зафиксировать правки».
          </p>
          {freeze.error && (
            <p className="text-[11px] text-red-600">{errorMessage(freeze.error)}</p>
          )}
        </div>
      ) : status === "blogger_review" ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <FileText size={14} /> Клиент внёс правки — отправьте финал блогеру
          </div>
          {placement.creativeDocText && (
            <div className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600">
              {placement.creativeDocText}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                // Сидим текст только при ОТКРЫТИИ — иначе повторный клик
                // (свернуть) затирает правки байера в textarea.
                if (!fwdOpen) setFwdText(placement.creativeDocText ?? "");
                setFwdOpen((v) => !v);
              }}
              disabled={!adminContactId || !sendAccountId}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              <Send size={12} /> Отправить блогеру
            </button>
            <button
              type="button"
              onClick={() => markApproved.mutate()}
              disabled={markApproved.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Check size={12} /> Блогер ОК
            </button>
            <button
              type="button"
              onClick={() => collect.mutate()}
              disabled={collect.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              <RefreshCw size={12} />
              {collect.isPending ? "…" : "Новая версия → собрать"}
            </button>
          </div>
          {fwdOpen && (
            <div className="space-y-1.5 rounded-lg border border-zinc-200 p-2">
              <textarea
                rows={4}
                value={fwdText}
                onChange={(e) => setFwdText(e.target.value)}
                placeholder="Финальный текст блогеру"
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
          {(markApproved.error || collect.error) && (
            <p className="text-[11px] text-red-600">
              {errorMessage(markApproved.error ?? collect.error)}
            </p>
          )}
        </div>
      ) : (
        // none / awaiting / internal_review — креатив помечен, собрать в док
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => collect.mutate()}
            disabled={collect.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={13} />
            {collect.isPending ? "Создаём док…" : "Собрать на согласование"}
          </button>
          {collect.error && (
            <p className="text-[11px] text-red-600">{errorMessage(collect.error)}</p>
          )}
        </div>
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
  const urlPlaceholder =
    placement.channel?.platform === "youtube"
      ? "https://youtube.com/watch?v=…"
      : placement.channel?.platform === "tiktok"
        ? "https://tiktok.com/@user/video/…"
        : "https://t.me/channel/123";
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
          placeholder={urlPlaceholder}
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


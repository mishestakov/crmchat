import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bell,
  Check,
  CheckCheck,
  Clock,
  MessageCircleReply,
  Plus,
  Sparkles,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { externalHref } from "../../../../../../lib/external-href";
import { getLeadHealth } from "../../../../../../lib/lead-health";
import { formatViews } from "../../../../../../lib/format";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import { type AccountRow } from "../../../../../../components/chat-drawer";
import { ChannelBadges } from "../../../../../../components/channel-badges";
import { AdminSuggestionBadge } from "../../../../../../components/admin-suggestion-badge";
import { RelationBadge } from "../../../../../../lib/channel-relation";
import { UnreadBadge } from "../../../../../../components/unread-badge";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { ChannelDrawer } from "../../../../../../components/channel-drawer";
import { LeadPrepPane } from "../../../../../../components/lead-prep-pane";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import { AddChannelsModal } from "../../../../../../components/add-channels-modal";
import { Modal } from "../../../../../../components/modal";
import {
  formatDateTime,
  formatPastRelative,
  formatRelative,
  pluralize,
} from "../../../../../../lib/date-utils";
import {
  useOutreachAccounts,
  useProject,
} from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK, invalidateProject } from "../../../../../../lib/query-keys";
import { useEventSourceEvent } from "../../../../../../lib/hooks";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/projects/$projectId/leads",
)({
  component: LeadsPage,
  // ?filter — сегмент триажа (общий для draft + active): flight (готовы/в
  // работе) / find_contact (инбокс поиска контакта) / manual (написать вручную)
  // / wont (отбраковано). Пусто = все. Из LaunchPanel приходит find_contact/wont.
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: "flight" | "find_contact" | "manual" | "wont" } => ({
    filter:
      search.filter === "flight" ||
      search.filter === "find_contact" ||
      search.filter === "manual" ||
      search.filter === "wont"
        ? search.filter
        : undefined,
  }),
});

const LEADS_PAGE_LIMIT = 1000;

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];
type LeadMessage = Lead["messages"][number];
type OutreachState = Lead["outreachState"];

// Триаж списка — ЕДИНАЯ ось на весь жизненный цикл (draft + active/paused):
// per-lead outreachState (бэк) → корзина «что с ним делать». Вью выбирается
// фильтром (сегментом), а не статусом проекта.
//   • flight        — система работает / уйдёт сам (draft: «Готовы», после: «В работе»)
//   • find_contact  — нет годного получателя → инбокс-резолвер («Найти контакт»)
//   • manual        — получатель известен, но авто-отправки нет → «Написать вручную»
//   • wont          — терминал (РКН/исключён) → «Отбраковано»
// replied → канбан (в триаж не попадает). Ключ — string (не Record<OutreachState>),
// чтобы новые состояния бэка (manual_method) не роняли билд до регена api-client.
type Bucket = "flight" | "find_contact" | "manual" | "wont";
// Value-тип с undefined: незамапленное состояние (replied / будущее из бэка) →
// undefined, а не «как бы Bucket» — чтобы `if (b)`-гарды были типо-обоснованы.
const STATE_BUCKET: Record<string, Bucket | undefined> = {
  not_scheduled: "flight",
  in_flight: "flight",
  no_contact: "find_contact",
  not_private: "find_contact",
  bot_manual: "manual",
  needs_review: "manual",
  manual_method: "manual", // личка канала/группа — слать вручную
  blocked_rkn: "wont",
  excluded: "wont",
};
const bucketOf = (s: OutreachState): Bucket | undefined => STATE_BUCKET[s];
// Активный сегмент = корзина или «Все» (undefined). Совпадает с ?filter.
type Filter = Bucket | undefined;

// Под-группы «Написать вручную» — получатель/способ известен, но авто-опенера
// нет. Порядок = порядок показа; действие под каждую (рендер ниже — по state).
const MANUAL_GROUPS: { state: string; title: string; hint: string }[] = [
  {
    state: "bot_manual",
    title: "Админ — бот",
    hint: "Откройте чат и запустите бота вручную.",
  },
  {
    state: "manual_method",
    title: "Ручной способ связи",
    hint:
      "Авто-отправки нет. Личка канала/группа — пишите в карточке канала " +
      "(«Открыть канал»); внешний способ (Instagram, почта…) — результат " +
      "фиксируйте в заметках («Открыть заметки»).",
  },
  {
    state: "needs_review",
    title: "Разобраться",
    hint: "Отправка не прошла — посмотрите причину.",
  },
];

// «Найти контакт» — нет годного получателя: контакт не найден ИЛИ найденный
// оказался каналом/группой. Обе ведут в один резолвер-инбокс (выбор контакта/
// способа). set-admin глобально перенаведёт график (repointPlacementSchedule).
const isRecipientFix = (s: OutreachState) =>
  s === "no_contact" || s === "not_private";

// Группировка списка по АДМИНУ: BD-аутрич = разговор на человека, не на канал.
// У каналов одного админа общий contactId/username → одна строка «канал +
// ещё N каналов этого админа», один чат, один опенер (он и так перечисляет
// все каналы). Каналы без резолвнутого админа (нет контакта) не группируются —
// у каждого свой резолв.
// Подпись канала: заголовок → @username → «—». Повторяется в строках триажа,
// сиблингах, таблице и инбоксе.
function channelLabel(channel: Lead["channel"]): string {
  return channel?.title || (channel?.username ? `@${channel.username}` : "—");
}


type LeadGroup = { key: string; primary: Lead; channels: Lead[] };

// Состояние строки = самый продвинутый канал админа. not_scheduled — ниже всех
// «живых»: охваченный сиблинг поглощается in_flight-каналом. Терминалы каналов
// (РКН/уже-работает) — ниже, чтобы не перебивать живой разговор; они всплывут,
// только если ВСЕ каналы админа терминальны.
// Ключ — string (как STATE_BUCKET): сгенерённый api-client-тип отстаёт от
// бэка до регена на хосте; Record<OutreachState> с новым состоянием ронял бы
// билд. Неизвестное состояние → 0 (?? в reduce ниже), не undefined-сравнение.
const STATE_PRIORITY: Record<string, number> = {
  replied: 100,
  needs_review: 90,
  bot_manual: 80,
  manual_method: 75,
  not_private: 70,
  no_contact: 60,
  in_flight: 50,
  not_scheduled: 40,
  excluded: 30,
  blocked_rkn: 10,
};

function groupLeadsByAdmin(leads: Lead[]): LeadGroup[] {
  const map = new Map<string, Lead[]>();
  for (const l of leads) {
    // username — первичный ключ: он стабилен и есть у всех каналов админа,
    // тогда как contactId проставляется позже (резолв/heal). Иначе админ, у
    // которого часть каналов уже резолвлена (contactId), а часть нет, распался
    // бы на две карточки (c:… и u:…). @username в TG уникален → ложного склея
    // двух людей не будет.
    const key = l.username
      ? `u:${l.username.toLowerCase()}`
      : l.contactId
        ? `c:${l.contactId}`
        : `solo:${l.id}`;
    const arr = map.get(key);
    if (arr) arr.push(l);
    else map.set(key, [l]);
  }
  return [...map.entries()].map(([key, channels]) => ({
    key,
    primary: channels.reduce((a, b) =>
      (STATE_PRIORITY[b.outreachState] ?? 0) >
      (STATE_PRIORITY[a.outreachState] ?? 0)
        ? b
        : a,
    ),
    channels,
  }));
}

function LeadsPage() {
  const { wsId, projectId } = Route.useParams();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [showAddChannels, setShowAddChannels] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
  // Карточка канала — для «Написать вручную» → личка канала/группа (там панель
  // способа связи; person-чат-дровер для них не подходит — получателя-человека нет).
  const [channelView, setChannelView] = useState<string | null>(null);
  // Инспект исключённого/терминального лида без контакта: открыть карточку
  // канала + резолвер в модалке, чтобы проверить/найти контакт не возвращая
  // лид в рассылку.
  const [inspectLeadId, setInspectLeadId] = useState<string | null>(null);
  // Драфт — инбокс подготовки (слева список, справа канал + резолвер
  // контакта, как агентский лонглист): выбранный лид. null → derive ниже
  // подхватит первого «без контакта» — после удаления/резолва фокус сам
  // переходит к следующему проблемному.
  const [prepLeadId, setPrepLeadId] = useState<string | null>(null);

  const seq = useProject(wsId, projectId);
  const accountsQ = useOutreachAccounts(wsId);
  const qc = useQueryClient();

  // Живые обновления pending/sent в таблице — те же события что слушает
  // /projects/{id} (index.tsx). Подписка активна только для active/paused
  // (draft и done не двигаются). Debounce 500ms схлопывает пачки сообщений
  // от worker'а в один refetch.
  const needsLiveUpdates =
    seq.data?.status === "active" || seq.data?.status === "paused";
  // Тик каждые 30с для перерисовки relative-времён («2 мин» → «3 мин»).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const invalidateTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
      }
    },
    [],
  );
  useEventSourceEvent(
    needsLiveUpdates
      ? `/v1/workspaces/${wsId}/projects/${projectId}/stream`
      : null,
    "changed",
    () => {
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
      }
      invalidateTimerRef.current = window.setTimeout(() => {
        qc.invalidateQueries({
          queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
        });
        invalidateTimerRef.current = null;
      }, 500);
    },
  );

  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.projectLeads(wsId, projectId, LEADS_PAGE_LIMIT, 0),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/leads",
        {
          params: {
            path: { wsId, projectId },
            query: { limit: LEADS_PAGE_LIMIT, offset: 0 },
          },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const total = leadsQ.data?.total ?? 0;
  const replied = leadsQ.data?.repliedCount ?? 0;

  // Группы по админу (одна карточка = один человек). Триаж-вид, таблица и
  // счётчики работают по группам, не по строкам-каналам.
  const allGroups = useMemo(
    () => groupLeadsByAdmin(leadsQ.data?.leads ?? []),
    [leadsQ.data],
  );
  const visibleGroups = useMemo(
    () =>
      filter
        ? allGroups.filter((g) => bucketOf(g.primary.outreachState) === filter)
        : allGroups,
    [allGroups, filter],
  );

  // Счётчики корзин (для сегмент-контрола) — по группам. Page-scoped; при
  // обрезке страницы есть TruncationBanner.
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = {
      flight: 0,
      find_contact: 0,
      manual: 0,
      wont: 0,
    };
    for (const g of allGroups) {
      const b = bucketOf(g.primary.outreachState);
      if (b) c[b] += 1;
    }
    return c;
  }, [allGroups]);

  // Сводка по выбранной странице (200 лидов); при больших задачах нужен
  // агрегат с бэка.
  const stickyCount =
    leadsQ.data?.leads.filter((l) => l.accountSource === "sticky").length ?? 0;
  const unassignedCount =
    leadsQ.data?.leads.filter(
      (l) => l.accountSource === null && l.account === null,
    ).length ?? 0;
  const isDraft = seq.data?.status === "draft";
  const canPrep =
    seq.data?.status === "active" || seq.data?.status === "paused";

  const drawerLead = leadsQ.data?.leads.find((l) => l.id === drawerLeadId);
  const inspectLead = leadsQ.data?.leads.find((l) => l.id === inspectLeadId);

  // Инбокс поиска контакта = вью сегмента «Найти контакт» (find_contact):
  // лиды без годного получателя (нет контакта / контакт — канал-группа). Одна
  // и та же вью в draft и active — без переключателя-режима.
  const inboxItems = useMemo(
    () =>
      (leadsQ.data?.leads ?? []).filter(
        (l) => bucketOf(l.outreachState) === "find_contact",
      ),
    [leadsQ.data],
  );

  // Вью определяется фильтром: «Найти контакт» → инбокс, остальные → список.
  const showPrepInbox = filter === "find_contact";
  // В черновике по умолчанию открываем инбокс (основная работа до запуска).
  // Разово: если оператор потом выберет «Все», силой не возвращаем.
  const defaultedRef = useRef(false);
  useEffect(() => {
    if (
      !defaultedRef.current &&
      isDraft &&
      filter === undefined &&
      counts.find_contact > 0
    ) {
      defaultedRef.current = true;
      navigate({ search: { filter: "find_contact" }, replace: true });
    }
  }, [isDraft, filter, counts.find_contact, navigate]);
  // Позиционный курсор: обработал/удалил лида — он уходит из инбокса, и
  // активным становится тот, кто встал на его место (по запомненному индексу),
  // а не первый в списке. Очередь едет под фиксированным курсором, без прыжка.
  // prepCursorRef = -1 до первого выбора → стартуем с первого проблемного.
  const prepCursorRef = useRef(-1);
  const prepLead = useMemo(() => {
    if (!showPrepInbox || inboxItems.length === 0) return undefined;
    const found = prepLeadId
      ? inboxItems.find((l) => l.id === prepLeadId)
      : undefined;
    if (found) return found;
    if (prepCursorRef.current >= 0) {
      return inboxItems[Math.min(prepCursorRef.current, inboxItems.length - 1)];
    }
    return inboxItems.find((l) => !l.contactReady) ?? inboxItems[0];
  }, [showPrepInbox, inboxItems, prepLeadId]);
  useEffect(() => {
    if (!prepLead) return;
    const idx = inboxItems.findIndex((l) => l.id === prepLead.id);
    if (idx >= 0) prepCursorRef.current = idx;
  }, [prepLead, inboxItems]);

  // Точечный стоп-кран: исключить лида из авто-рассылки / вернуть обратно.
  const skipLead = useMutation({
    mutationFn: async (vars: { itemId: string; skipped: boolean }) => {
      const path = { wsId, projectId, itemId: vars.itemId };
      const { error } = vars.skipped
        ? await api.POST(
            "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unskip",
            { params: { path } },
          )
        : await api.POST(
            "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/skip",
            { params: { path } },
          );
      if (error) throw error;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId, { leads: true }),
  });

  // Стадия из дровера (StageStrip). Для external-лида это ЕДИНСТВЕННЫЙ вход на
  // канбан: repliedAt у него не появится (нет адаптера), карточка попадает на
  // доску по заданной стадии. Без оптимистики (в отличие от канбана): здесь нет
  // drag-drop, инвалидация успевает.
  const setStage = useMutation({
    mutationFn: async (vars: { itemId: string; stageId: string | null }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
        {
          params: { path: { wsId, projectId, itemId: vars.itemId } },
          body: { stageId: vars.stageId },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId, { leads: true }),
  });

  // Единая ось сегментов на весь цикл. «Готовы к отправке» (draft) читается как
  // «В работе» после запуска — та же корзина flight. Пустые прячем (кроме «Все»),
  // чтобы draft не пестрил «Написать вручную · 0».
  const flightLabel = isDraft ? "Готовы к отправке" : "В работе";
  const segments = (
    [
      { key: undefined, label: "Все", count: allGroups.length },
      { key: "flight", label: flightLabel, count: counts.flight },
      { key: "find_contact", label: "Найти контакт", count: counts.find_contact },
      { key: "manual", label: "Написать вручную", count: counts.manual },
      { key: "wont", label: "Отбраковано", count: counts.wont },
    ] as { key: Filter; label: string; count: number }[]
  ).filter((s) => s.key === undefined || s.count > 0);
  const setFilter = (key: Filter) =>
    navigate({ search: { filter: key }, replace: true });
  // Открыть резолвер на конкретном лиде (клик по строке в «Все»/«В работе») —
  // это просто переход на сегмент «Найти контакт», без смены вьюхи по кнопке.
  const openResolver = (leadId?: string) => {
    if (leadId) setPrepLeadId(leadId);
    navigate({ search: { filter: "find_contact" }, replace: true });
  };

  return (
    <div className="space-y-3">
      <ProjectTabs wsId={wsId} projectId={projectId} />
      <div className="mx-auto w-full max-w-6xl space-y-4 px-6">
        <div className="flex flex-wrap items-center gap-3">
          {seq.data?.status !== "done" &&
            seq.data?.status !== "archived" && (
            <button
              type="button"
              onClick={() => setShowAddChannels(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
            >
              <Plus size={15} />
              Добавить каналы
            </button>
          )}
          {segments.length > 1 && (
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5 text-sm">
              {segments.map((s) => {
                const active = filter === s.key;
                return (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setFilter(s.key)}
                    className={
                      "rounded-md px-3 py-1 font-medium transition-colors " +
                      (active
                        ? "bg-white text-zinc-900 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-800")
                    }
                  >
                    {s.label}
                    {s.key !== undefined && (
                      <span className="ml-1 text-zinc-400">{s.count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-xs text-zinc-500">
          {filter === "flight" ? (
            <>{flightLabel}: {counts.flight} из {allGroups.length}</>
          ) : filter === "find_contact" ? (
            <>Найти контакт: {counts.find_contact} из {allGroups.length}</>
          ) : filter === "manual" ? (
            <>Написать вручную: {counts.manual} из {allGroups.length}</>
          ) : filter === "wont" ? (
            <>Отбраковано: {counts.wont} из {allGroups.length}</>
          ) : (
            <>
              Всего {total} {pluralize(total, "канал", "канала", "каналов")}
              {replied > 0 && ` · ${replied} ответили`}
            </>
          )}
          {isDraft && stickyCount > 0 && (
            <>
              {" · "}
              <span className="text-amber-700">
                {stickyCount} закреплены за аккаунтом
              </span>
            </>
          )}
          {isDraft && unassignedCount > 0 && (
            <>
              {" · "}
              <span>{unassignedCount} в round-robin</span>
            </>
          )}
        </div>

        {leadsQ.isLoading && (
          <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
            Загрузка каналов…
          </div>
        )}
        {leadsQ.error && (
          <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
            {errorMessage(leadsQ.error)}
          </div>
        )}
        {leadsQ.data && leadsQ.data.leads.length === 0 && (
          <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
            В проекте пока нет каналов. Нажмите «Добавить каналы».
          </div>
        )}
        {leadsQ.data &&
          leadsQ.data.leads.length > 0 &&
          !showPrepInbox &&
          visibleGroups.length === 0 && (
            <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
              {filter ? "В этой корзине пусто." : "Список пуст."}
            </div>
          )}
        {leadsQ.data &&
          leadsQ.data.leads.length > 0 &&
          showPrepInbox &&
          inboxItems.length === 0 && (
            <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
              Искать некого — получатели заданы у всех каналов.{" "}
              <button
                type="button"
                onClick={() => setFilter(undefined)}
                className="font-medium text-emerald-700 hover:underline"
              >
                ко всем каналам
              </button>
            </div>
          )}
        {leadsQ.data && leadsQ.data.leads.length === LEADS_PAGE_LIMIT && (
          <TruncationBanner
            shown={LEADS_PAGE_LIMIT}
            total={leadsQ.data.total}
            entity="каналов"
          />
        )}
        {/* «Написать вручную» — сгруппировано по причине, у каждой своё
            действие (открыть чат / открыть карточку канала). */}
        {leadsQ.data &&
          filter === "manual" &&
          visibleGroups.length > 0 && (
            <div className="space-y-4">
              {MANUAL_GROUPS.map((g) => {
                const groupLeads = visibleGroups.filter(
                  (grp) => grp.primary.outreachState === g.state,
                );
                if (groupLeads.length === 0) return null;
                return (
                  <div
                    key={g.state}
                    className="overflow-hidden rounded-2xl bg-white shadow-sm"
                  >
                    <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
                      <div className="text-sm font-semibold text-zinc-800">
                        {g.title} · {groupLeads.length}
                      </div>
                      <div className="text-xs text-zinc-500">{g.hint}</div>
                    </div>
                    <ul className="divide-y divide-zinc-100">
                      {groupLeads.map((grp) => {
                        const l = grp.primary;
                        const cm = l.contactMethod;
                        return (
                        <li
                          key={grp.key}
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {channelLabel(l.channel)}
                              </span>
                              {l.channel && (
                                <ChannelBadges
                                  username={l.channel.username}
                                  link={l.channel.link}
                                  isRkn={l.channel.isRkn}
                                  memberCount={l.channel.memberCount}
                                />
                              )}
                            </div>
                            {l.username && (
                              <div className="text-xs text-zinc-500">
                                админ @{l.username}
                              </div>
                            )}
                            {cm?.kind === "external" && (
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                                <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-violet-200">
                                  Внешний: {cm.label ?? "способ связи"}
                                </span>
                                {cm.link && (
                                  <a
                                    href={externalHref(cm.link)}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-violet-600 hover:underline"
                                  >
                                    открыть ↗
                                  </a>
                                )}
                              </div>
                            )}
                            <SiblingChannels group={grp} />
                            {g.state === "needs_review" && (
                              <div className="text-xs text-red-600">
                                {humanizeSendError(
                                  l.messages.find((m) => m.status === "failed")
                                    ?.error ?? null,
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {/* external → дровер (заметки), личка/группа →
                                карточка канала, остальное → чат. */}
                            <button
                              type="button"
                              onClick={() =>
                                g.state === "manual_method" &&
                                cm?.kind !== "external"
                                  ? l.channel && setChannelView(l.channel.id)
                                  : setDrawerLeadId(l.id)
                              }
                              className="rounded-lg px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
                            >
                              {g.state !== "manual_method"
                                ? "Открыть чат"
                                : cm?.kind === "external"
                                  ? "Открыть заметки"
                                  : "Открыть канал"}
                            </button>
                            {g.state === "needs_review" && (
                              <button
                                type="button"
                                onClick={() =>
                                  skipLead.mutate({
                                    itemId: l.id,
                                    skipped: !!l.skippedAt,
                                  })
                                }
                                className="rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-red-600"
                              >
                                Исключить
                              </button>
                            )}
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        {leadsQ.data && inboxItems.length > 0 && showPrepInbox && (
          // Инбокс подготовки (D1, как агентский лонглист): слева компактный
          // список, справа канал + резолвер выбранного. Поточная обработка —
          // удалил/нашёл контакт → фокус сам уходит к следующему проблемному.
          <div className="flex h-[calc(100vh-300px)] min-h-[420px] overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="w-72 shrink-0 overflow-y-auto border-r border-zinc-200">
              {inboxItems.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setPrepLeadId(l.id)}
                  className={
                    "block w-full border-b border-zinc-100 px-3 py-2 text-left " +
                    (l.id === prepLead?.id ? "bg-emerald-50" : "hover:bg-zinc-50")
                  }
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                    <span className="truncate">
                      {channelLabel(l.channel)}
                    </span>
                    {l.channel && (
                      <ChannelBadges
                        username={l.channel.username}
                        link={l.channel.link}
                        isRkn={l.channel.isRkn}
                        memberCount={l.channel.memberCount}
                      />
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs">
                    {l.outreachState === "not_private" ? (
                      <span className="font-medium text-amber-700">
                        контакт — канал или группа
                      </span>
                    ) : l.contactReady ? (
                      <span className="text-zinc-500">
                        {l.username ? `админ @${l.username}` : "способ связи выбран"}
                      </span>
                    ) : (
                      <span className="font-medium text-amber-700">
                        контакт не найден
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              {prepLead && (
                <LeadPrepPane
                  key={prepLead.id}
                  wsId={wsId}
                  projectId={projectId}
                  lead={prepLead}
                  running={canPrep}
                  onRemoved={() => setPrepLeadId(null)}
                />
              )}
            </div>
          </div>
        )}
        {/* Таблица-диагностика: Все / В работе / Отбраковано. «Найти контакт»
            рисуется инбоксом, «Написать вручную» — сгруппированным видом выше. */}
        {leadsQ.data &&
          visibleGroups.length > 0 &&
          !showPrepInbox &&
          filter !== "manual" && (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="sticky left-0 bg-zinc-50 px-4 py-2 text-left font-normal">
                    Канал
                  </th>
                  <th className="px-4 py-2 text-left font-normal">Аккаунт</th>
                  {/* Опенер — первое холодное касание. Прогресс пиналки (X/N)
                      живёт бейджем в карточке лида слева, отдельной колонки нет. */}
                  <th className="px-4 py-2 text-left font-normal">Опенер</th>
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((grp) => {
                  const l = grp.primary;
                  // Подсветка застоя (§1.4): красный — левым бордером строки,
                  // чтобы не спорить с зелёным фоном «ответил».
                  const health = getLeadHealth(l);
                  return (
                  <tr
                    key={grp.key}
                    onClick={() => {
                      // Нет рабочего получателя (нет контакта / контакт — канал/
                      // группа) → сегмент «Найти контакт» (инбокс), работает и в
                      // draft. Есть контакт → дровер (для external-stub'а без
                      // tg/max-ключей он сам показывает заметки вместо TG-чата).
                      // Личка канала/группа (manual, без контакта-человека) →
                      // карточка канала. Иначе (терминальный без контакта) →
                      // инспект-модалка: проверить, не возвращая лид.
                      if (isRecipientFix(l.outreachState)) openResolver(l.id);
                      else if (l.contactId) setDrawerLeadId(l.id);
                      else if (bucketOf(l.outreachState) === "manual" && l.channel)
                        setChannelView(l.channel.id);
                      else if (canPrep) setInspectLeadId(l.id);
                    }}
                    className={
                      "group cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 " +
                      (health.color === "red"
                        ? "border-l-2 border-l-red-400 "
                        : "") +
                      (l.repliedAt ? "bg-emerald-50/40 " : "") +
                      (l.skippedAt ? "opacity-60" : "")
                    }
                  >
                    <td
                      className="sticky left-0 px-4 py-2 align-top"
                      style={{ background: "inherit" }}
                    >
                      <LeadCell
                        lead={l}
                        group={grp}
                        wsId={wsId}
                        canSkip={canPrep}
                        onToggleSkip={() =>
                          skipLead.mutate({
                            itemId: l.id,
                            skipped: !!l.skippedAt,
                          })
                        }
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <AccountCell
                        account={l.account}
                        accountSource={l.accountSource}
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <MessageStatusCell
                        msg={l.messages.find((m) => m.messageIdx === 0)}
                        repliedAt={l.repliedAt}
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            {leadsQ.data.total > leadsQ.data.leads.length && (
              <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500">
                Показано {leadsQ.data.leads.length} из {leadsQ.data.total}.
              </p>
            )}
          </div>
        )}
      </div>
      {drawerLead && (
        <LeadChatDrawer
          wsId={wsId}
          lead={drawerLead}
          accounts={accountsQ.data ?? []}
          onClose={() => setDrawerLeadId(null)}
          stageControl={{
            stages: [...(seq.data?.stages ?? [])].sort(
              (a, b) => a.order - b.order,
            ),
            currentStageId: drawerLead.stageId ?? null,
            onSetStage: (stageId) =>
              setStage.mutate({ itemId: drawerLead.id, stageId }),
            onOpenFullCard: () => {
              if (drawerLead.contactId)
                navigate({
                  to: "/w/$wsId/contacts/$id",
                  params: { wsId, id: drawerLead.contactId },
                });
            },
            disabled: seq.data?.status === "done",
          }}
        />
      )}
      {channelView && (
        <ChannelDrawer
          wsId={wsId}
          channelId={channelView}
          onClose={() => setChannelView(null)}
          onResolved={() =>
            invalidateProject(qc, wsId, projectId, { leads: true })
          }
        />
      )}
      {inspectLead && (
        <Modal
          onClose={() => setInspectLeadId(null)}
          size="lg"
          title="Проверить контакт"
        >
          <div className="h-[70vh] overflow-hidden">
            <LeadPrepPane
              wsId={wsId}
              projectId={projectId}
              lead={inspectLead}
              running={canPrep}
              showRemove={false}
              onRemoved={() => setInspectLeadId(null)}
            />
          </div>
        </Modal>
      )}
      {showAddChannels && (
        <AddChannelsModal
          wsId={wsId}
          projectId={projectId}
          onClose={() => setShowAddChannels(false)}
          onAdded={() => invalidateProject(qc, wsId, projectId, { leads: true })}
          outreach={
            canPrep && seq.data
              ? { status: seq.data.status as "active" | "paused" }
              : undefined
          }
        />
      )}
    </div>
  );
}


// Прочие каналы того же админа (склейка по человеку): «ещё N: Канал, Канал».
// Один разговор/опенер уже покрывает их все — показываем, чтобы менеджер видел,
// что контакт по ним учтён, и не искал «потерянные» строки.
function SiblingChannels({ group }: { group: LeadGroup }) {
  const others = group.channels.filter((c) => c.id !== group.primary.id);
  if (others.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
      <span className="text-zinc-400">ещё {others.length} канал(а) админа:</span>
      {others.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1">
          {channelLabel(c.channel)}
          {c.channel?.isRkn && (
            <span title="В реестре РКН / заблокирован" className="text-red-600">
              🚫
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// Обогащённый бейдж «Каналы Яндекса»: цвет = свежесть (работает/простаивает/
// проблема), тултип (native title) = источники + свежесть + здоровье. Данные —
// суточный синк CPC/CPA, окно 60 дней. Информ-сигнал, не гейт.
type PlatformActivity = NonNullable<
  NonNullable<Lead["channel"]>["platformActivity"]
>;

// CPA moderation_status приходит как «<код>: <текст>». Красим 🔴 отказы
// модерации и технические блокеры (по распределению статусов от 2026-07-01):
// 1 маленькая аудитория, 2 контент не подходит, 8 отказ, 12 отвязана,
// 16 отказ по оферте, 23 фрод, 29 бот не админ. 11 «тестовый период» — НЕ
// отказ, его состояние решает свежесть постов. NULL — статуса нет.
const PROBLEM_MODERATION_CODES = new Set([1, 2, 8, 12, 16, 23, 29]);
function isProblemModeration(s: string | null): boolean {
  const code = s ? Number.parseInt(s, 10) : NaN;
  return Number.isFinite(code) && PROBLEM_MODERATION_CODES.has(code);
}

function formatPostDate(iso: string | null): string {
  if (!iso) return "не видели";
  const [y, m, d] = iso.split("-");
  return d ? `${d}.${m}.${y}` : iso;
}

const PLATFORM_SOURCE_LABEL: Record<string, string> = {
  cpc: "CPC (Директ)",
  cpa: "CPA (партнёрка)",
};

function PlatformActivityBadge({ activity }: { activity: PlatformActivity }) {
  const problem =
    activity.isActive === false ||
    (activity.botStatus !== null && activity.botStatus !== "OK") ||
    isProblemModeration(activity.moderationStatus);
  const { label, cls } = problem
    ? { label: "проблема", cls: "bg-rose-100 text-rose-700" }
    : activity.recentPosts > 0
      ? { label: "работает", cls: "bg-emerald-100 text-emerald-700" }
      : { label: "простаивает", cls: "bg-amber-100 text-amber-700" };
  // На бейдже — источник (Я.CPC / Я.CPA / Я.CPA+CPC): понятно, о чём сигнал.
  // Состояние (работает/простаивает/проблема) несёт цвет + первая строка тултипа.
  const sourceTag = `Я.${activity.sources.map((s) => s.toUpperCase()).join("+")}`;

  const lines = [
    `Каналы Яндекса · ${label}`,
    `Источники: ${activity.sources
      .map((s) => PLATFORM_SOURCE_LABEL[s] ?? s)
      .join(" · ")}`,
    `Последний пост: ${formatPostDate(activity.lastPostDate)}`,
    `За 60 дней: ${activity.recentPosts} постов · ${formatViews(
      activity.recentViews,
    )} показов`,
  ];
  if (activity.moderationStatus)
    lines.push(`Модерация (CPA): ${activity.moderationStatus}`);
  const cpc: string[] = [];
  if (activity.isActive !== null)
    cpc.push(activity.isActive ? "активен" : "выключен");
  if (activity.isCpv) cpc.push("допущен к CPV");
  if (activity.botStatus && activity.botStatus !== "OK")
    cpc.push(`бот: ${activity.botStatus}`);
  if (cpc.length) lines.push(`CPC: ${cpc.join(" · ")}`);

  return (
    <span
      title={lines.join("\n")}
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {sourceTag}
    </span>
  );
}

function LeadCell({
  lead,
  group,
  wsId,
  canSkip,
  onToggleSkip,
}: {
  lead: Lead;
  group: LeadGroup;
  wsId: string;
  // Исключение из рассылки доступно в active/paused (в draft лида удаляют).
  canSkip: boolean;
  onToggleSkip: () => void;
}) {
  const ch = lead.channel;
  // «Уже общались»: replied перекрывает talked. null — сигнала нет.
  const history = lead.contactHistory;
  const contactBadge = history?.replied
    ? {
        label: "был диалог",
        title: "С этим контактом уже был диалог — открыть переписку",
        cls: "bg-emerald-100 text-emerald-700",
      }
    : history?.talked
      ? {
          label: "писали",
          title: "Этому контакту уже писали, ответа не было — открыть переписку",
          cls: "bg-sky-100 text-sky-700",
        }
      : null;
  const admin = lead.username ? `@${lead.username}` : null;
  const health = getLeadHealth(lead);
  const toggleSkip = (e: React.MouseEvent) => {
    e.stopPropagation(); // клик по строке открывает drawer
    onToggleSkip();
  };
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="font-medium">{channelLabel(ch)}</span>
        {ch && (
          <ChannelBadges
            username={ch.username}
            link={ch.link}
            isRkn={ch.isRkn}
            memberCount={ch.memberCount}
          />
        )}
        {/* Активность на рекл-платформах Яндекса (CPC/CPA) — правее РКН.
            Информ-сигнал, НЕ гейт; contactReady не гейтит (активность от
            готовности контакта не зависит). */}
        {ch?.platformActivity && (
          <PlatformActivityBadge activity={ch.platformActivity} />
        )}
        {/* Чип непрочитанных — как на канбане. Виден и при снятой галочке
            «только не ответившие»: клик по строке открывает чат. */}
        {(lead.unreadCount > 0 || lead.markedUnread) && (
          <span
            title={
              lead.unreadCount > 0
                ? `${lead.unreadCount} непрочитанных — открыть чат`
                : "Помечено непрочитанным"
            }
          >
            <UnreadBadge count={lead.unreadCount} dot={lead.markedUnread} />
          </span>
        )}
        {/* «Уже общались» с этим контактом (cross-project, по любому проекту
            воркспейса). Справочно, не гейт: клик по строке откроет переписку. */}
        {contactBadge && (
          <span
            title={contactBadge.title}
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${contactBadge.cls}`}
          >
            {contactBadge.label}
          </span>
        )}
        {/* Модификатор исхода по каналу — канонический RelationBadge; none/pending
            в этой витрине не показываем (нет содержательного исхода). */}
        {ch && ch.relationStatus !== "none" && ch.relationStatus !== "pending" && (
          <RelationBadge status={ch.relationStatus} />
        )}
      </div>
      {admin && (
        <div className="text-xs text-zinc-500" title="Админ-получатель аутрича">
          админ {admin}
        </div>
      )}
      {ch?.suggestedAdmin && (
        <AdminSuggestionBadge
          wsId={wsId}
          channelId={ch.id}
          suggestedAdmin={ch.suggestedAdmin}
        />
      )}
      <SiblingChannels group={group} />
      {health.badge?.kind === "dunning" && (
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <Bell size={11} className="shrink-0 text-zinc-400" />
          <span>
            пиналка {health.badge.sent}/{health.badge.total}
          </span>
        </div>
      )}
      {health.badge?.kind === "stale" && (
        <div
          className={
            "flex items-center gap-1 text-xs " +
            (health.color === "red" ? "text-red-500" : "text-zinc-500")
          }
        >
          <Clock
            size={11}
            className={
              "shrink-0 " +
              (health.color === "red" ? "text-red-400" : "text-zinc-400")
            }
          />
          <span>
            затихло {health.badge.days}{" "}
            {pluralize(health.badge.days, "день", "дня", "дней")} назад
          </span>
        </div>
      )}
      {!lead.contactReady && (
        // Отбраковка «без контакта» — опенер не уйдёт, пока не найден контакт
        // (no-rkn виден красной пилюлей РКН рядом с названием — не дублируем).
        <div>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
            без контакта
          </span>
        </div>
      )}
      {lead.repliedAt && lead.contactId && (
        <Link
          to="/w/$wsId/contacts/$id"
          onClick={(e) => e.stopPropagation()}
          params={{ wsId, id: lead.contactId }}
          className="text-xs text-emerald-700 hover:underline"
        >
          → контакт
        </Link>
      )}
      {lead.skippedAt ? (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-600">
            исключён из рассылки
          </span>
          {canSkip && (
            <button
              type="button"
              onClick={toggleSkip}
              className="font-medium text-emerald-700 hover:underline"
            >
              вернуть
            </button>
          )}
        </div>
      ) : (
        canSkip && (
          <button
            type="button"
            onClick={toggleSkip}
            title="Отменить запланированные сообщения этому лиду"
            className="text-xs text-zinc-400 opacity-0 hover:text-red-600 hover:underline group-hover:opacity-100"
          >
            исключить из рассылки
          </button>
        )
      )}
    </div>
  );
}

function AccountCell(props: {
  account: Lead["account"];
  accountSource: Lead["accountSource"];
}) {
  if (!props.account) {
    // accountSource=null + account=null → лид незнаком, при активации уйдёт
    // в round-robin. Показываем явный плейсхолдер вместо пустого «—».
    return (
      <span
        className="text-xs text-zinc-500"
        title="Этот лид незнаком — при запуске уйдёт к свободному аккаунту (round-robin)"
      >
        не закреплён
      </span>
    );
  }
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex items-center gap-1 font-medium text-zinc-800">
        {props.account.firstName ?? "—"}
        {props.account.hasPremium && (
          <Sparkles size={10} className="text-amber-500" />
        )}
      </div>
      <div className="text-zinc-500">
        {props.account.tgUsername ? `@${props.account.tgUsername}` : ""}
        {props.account.tgUsername && props.account.phoneNumber ? " · " : ""}
        {props.account.phoneNumber ?? ""}
      </div>
      {props.accountSource === "sticky" && (
        <div
          className="text-[10px] uppercase tracking-wide text-amber-700"
          title="Закреплён по истории общения. На активации останется этот же аккаунт."
        >
          закреплён
        </div>
      )}
    </div>
  );
}

function MessageStatusCell(props: {
  msg: LeadMessage | undefined;
  repliedAt: string | null;
}) {
  const { msg, repliedAt } = props;
  if (!msg) {
    return <span className="text-xs text-zinc-400">не запланировано</span>;
  }

  // Если лид ответил И это сообщение реально доставлено — показываем replied.
  // Логика донора: replied-маркер ставится на каждое уже-отправленное сообщение
  // после того как лид ответил, как сигнал «дальше не пойдёт, разговор открыт».
  if (repliedAt && msg.sentAt) {
    return (
      <StatusBadge
        icon={<MessageCircleReply size={12} />}
        color="emerald"
        title={`Ответил ${formatDateTime(repliedAt)}`}
        label={`Ответил ${formatPastRelative(repliedAt)}`}
      />
    );
  }

  if (msg.status === "failed") {
    const reason = humanizeSendError(msg.error);
    return (
      <StatusBadge
        icon={<AlertCircle size={12} />}
        color="red"
        title={msg.error ?? "Ошибка отправки"}
        label={reason}
      />
    );
  }
  if (msg.status === "cancelled") {
    return <span className="text-xs text-zinc-400">отменено</span>;
  }
  if (msg.status === "pending") {
    // send_at — мягкая граница «не раньше чем». Догоны (msg_idx>0) до
    // факт-отправки предыдущего шага лежат с sentinel в 2999 году — это
    // маркер «ждёт предыдущего», точный момент будет известен только
    // когда worker отправит msg_idx-1. После наступления sendAt — «в
    // очереди»: worker дойдёт когда дойдёт (human-flow на других лидах).
    const at = msg.scheduledAt ? new Date(msg.scheduledAt).getTime() : 0;
    const isSentinel = at > Date.now() + 365 * 24 * 60 * 60 * 1000;
    const when = isSentinel
      ? "после предыдущего"
      : at > Date.now()
        ? formatRelative(msg.scheduledAt!, { future: true })
        : "в очереди";
    return <span className="text-xs text-zinc-500">{when}</span>;
  }
  // sent
  if (msg.readAt) {
    return (
      <StatusBadge
        icon={<CheckCheck size={12} />}
        color="blue"
        title={`Прочитано ${formatDateTime(msg.readAt)}`}
        label={`Прочитано ${formatPastRelative(msg.readAt)}`}
      />
    );
  }
  return (
    <StatusBadge
      icon={<Check size={12} />}
      color="zinc"
      title={`Отправлено ${formatDateTime(msg.sentAt ?? "")}`}
      label={`Отправлено ${formatPastRelative(msg.sentAt ?? "")}`}
    />
  );
}

function StatusBadge(props: {
  icon: React.ReactNode;
  color: "zinc" | "blue" | "emerald" | "red";
  label: string;
  title?: string;
}) {
  const palette = {
    zinc: "text-zinc-700",
    blue: "text-blue-600",
    emerald: "text-emerald-700",
    red: "text-red-600",
  }[props.color];
  return (
    <span
      className={"inline-flex items-center gap-1 text-xs " + palette}
      title={props.title}
    >
      {props.icon}
      <span className="whitespace-nowrap">{props.label}</span>
    </span>
  );
}

// Маппинг типичных TG/TDLib-ошибок sendMessage в краткий ru-label для плашки.
// Полный текст остаётся в title (tooltip) — менеджер видит причину сразу,
// технические детали — по hover.
function humanizeSendError(raw: string | null): string {
  if (!raw) return "Ошибка";
  if (/USERNAME_INVALID|USERNAME_NOT_OCCUPIED|No such public user|Username not occupied/i.test(raw)) {
    return "@username не существует";
  }
  if (/USER_PRIVACY_RESTRICTED/i.test(raw)) return "Закрытая приватность";
  if (/USER_IS_BLOCKED|YOU_BLOCKED_USER/i.test(raw)) return "Заблокирован";
  // PEER_FLOOD — антиспам TG на письма НОВЫМ/незнакомым, не бан аккаунта.
  // «Зарезан» пугало менеджеров зря: аккаунт жив, ограничение временное.
  if (/PEER_FLOOD/i.test(raw)) return "TG ограничил: писать новым";
  if (/USER_DEACTIVATED|INPUT_USER_DEACTIVATED/i.test(raw)) return "Аккаунт удалён";
  if (/CHAT_WRITE_FORBIDDEN/i.test(raw)) return "Писать запрещено";
  if (/PHONE_NOT_SUPPORTED/i.test(raw)) return "Только @username";
  if (/Bot can't initiate conversation/i.test(raw)) return "Бот не пишет первым";
  if (/MESSAGE_EMPTY|MESSAGE_TOO_LONG/i.test(raw)) return "Длина сообщения";
  if (/send update lost/i.test(raw)) return "Подтверждение потеряно";
  return "Ошибка";
}


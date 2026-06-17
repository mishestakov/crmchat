import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  MessageCircleReply,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import { type AccountRow } from "../../../../../../components/chat-drawer";
import {
  ChannelBadges,
  RKN_THRESHOLD,
} from "../../../../../../components/channel-badges";
import { UnreadBadge } from "../../../../../../components/unread-badge";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { LeadPrepPane } from "../../../../../../components/lead-prep-pane";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import { AddChannelsModal } from "../../../../../../components/add-channels-modal";
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
  // ?filter — сегмент списка: unreplied (не ответившие) или rejected (вся
  // отбраковка: без контакта + без РКН). Пусто = все. Из LaunchPanel приходит
  // ?filter=rejected.
  validateSearch: (
    search: Record<string, unknown>,
  ): { filter?: "unreplied" | "rejected" } => ({
    filter:
      search.filter === "unreplied" || search.filter === "rejected"
        ? search.filter
        : undefined,
  }),
});

const LEADS_PAGE_LIMIT = 1000;

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];
type LeadMessage = Lead["messages"][number];

// Причина отбраковки лида — зеркало бэк-гейта (prepareLeads / readiness).
// Приоритет: контакт → уже работает у нас → РКН (>10к и не в реестре = красная
// пилюля «Нет РКН»). null — лид годен к отправке.
type RejectReason = "no-contact" | "working" | "no-rkn";
function rejectReason(lead: Lead): RejectReason | null {
  if (!lead.contactReady) return "no-contact";
  const ch = lead.channel;
  if (ch?.alreadyWorking) return "working";
  if (ch && !ch.isRkn && ch.memberCount != null && ch.memberCount > RKN_THRESHOLD)
    return "no-rkn";
  return null;
}

function LeadsPage() {
  const { wsId, projectId } = Route.useParams();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onlyUnreplied = filter === "unreplied";
  const onlyRejected = filter === "rejected";
  const [showAddChannels, setShowAddChannels] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);
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

  const totalMsgCount = seq.data?.messages.length ?? 0;
  const total = leadsQ.data?.total ?? 0;
  const replied = leadsQ.data?.repliedCount ?? 0;
  const visibleLeads = useMemo(() => {
    if (!leadsQ.data) return [];
    let out = leadsQ.data.leads;
    if (onlyUnreplied) {
      out = out.filter((l) => !l.repliedAt);
    }
    if (onlyRejected) {
      out = out.filter((l) => rejectReason(l) !== null);
    }
    return out;
  }, [leadsQ.data, onlyUnreplied, onlyRejected]);

  // Счётчик отбраковки на странице (для сегмента фильтра).
  const rejectedTotal = useMemo(
    () =>
      leadsQ.data?.leads.filter((l) => rejectReason(l) !== null).length ?? 0,
    [leadsQ.data],
  );

  // Сводка по выбранной странице (200 лидов); при больших задачах нужен
  // агрегат с бэка.
  const stickyCount =
    leadsQ.data?.leads.filter((l) => l.accountSource === "sticky").length ?? 0;
  const unassignedCount =
    leadsQ.data?.leads.filter(
      (l) => l.accountSource === null && l.account === null,
    ).length ?? 0;
  const isDraft = seq.data?.status === "draft";

  const drawerLead = visibleLeads.find((l) => l.id === drawerLeadId);
  const noContactTotal =
    leadsQ.data?.leads.filter((l) => !l.contactReady).length ?? 0;

  // Доливка в идущий проект: каналы без контакта обрабатываются тем же
  // инбоксом, что и драфт — вход по баннеру над таблицей, выход автоматом,
  // когда всё обработано (контакт найден → бэк сам планирует опенер,
  // set-admin → scheduleDolivkaForChannel).
  const canPrep =
    seq.data?.status === "active" || seq.data?.status === "paused";
  const [prepMode, setPrepMode] = useState(false);
  useEffect(() => {
    if (prepMode && (!canPrep || noContactTotal === 0)) setPrepMode(false);
  }, [prepMode, canPrep, noContactTotal]);
  // В режиме отбраковки показываем плоскую таблицу (с причиной у каждой
  // строки), а не prep-инбокс — он только про поиск контакта.
  const showPrepInbox = !onlyRejected && (isDraft || (canPrep && prepMode));
  const inboxItems = isDraft
    ? visibleLeads
    : (leadsQ.data?.leads ?? []).filter((l) => !l.contactReady);
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

  // Холодная доливка: список отыгран → новые лиды не планируются сами,
  // запускает явная кнопка. Счёт с бэка (страница может быть обрезана).
  const unscheduledCount = leadsQ.data?.unscheduledCount ?? 0;
  const scheduleNew = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/schedule-new-leads",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId, { leads: true }),
  });

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

  // Один сегмент-контрол вместо россыпи чекбоксов/чипов: «Все · Не ответившие ·
  // Отбракованные». «Не ответившие» — только когда уже что-то отправлено
  // (не в draft); «Отбракованные» — только когда есть кого браковать.
  const segments: { key: "unreplied" | "rejected" | undefined; label: string }[] =
    [
      { key: undefined, label: "Все" },
      ...(!isDraft
        ? [{ key: "unreplied" as const, label: "Не ответившие" }]
        : []),
      ...(rejectedTotal > 0 || onlyRejected
        ? [{ key: "rejected" as const, label: `Отбракованные · ${rejectedTotal}` }]
        : []),
    ];
  const setFilter = (key: "unreplied" | "rejected" | undefined) =>
    navigate({ search: { filter: key }, replace: true });
  // Резолвер контактов: из draft открыт всегда (prep-инбокс), в активном —
  // через «Найти контакты» из вкладки отбраковки.
  const openResolver = () => {
    if (canPrep) setPrepMode(true);
    setFilter(undefined);
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
          {prepMode ? (
            <button
              type="button"
              onClick={() => setPrepMode(false)}
              className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              ← к таблице рассылки
            </button>
          ) : (
            segments.length > 1 && (
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
                    </button>
                  );
                })}
              </div>
            )
          )}
          {canPrep && !prepMode && unscheduledCount > 0 && (
            // Холодная доливка: годные лиды без запланированного опенера
            // (счётчик уже исключает отбракованных по РКН — кнопка не no-op).
            <button
              type="button"
              disabled={scheduleNew.isPending}
              onClick={() => scheduleNew.mutate()}
              title={
                seq.data?.status === "paused"
                  ? "Проект на паузе — уйдут после возобновления"
                  : "Запланировать опенер новым лидам"
              }
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50 disabled:opacity-50"
            >
              <Send size={14} />
              {scheduleNew.isPending
                ? "Планируем…"
                : `Дослать новым (${unscheduledCount})`}
            </button>
          )}
        </div>

        <div className="text-xs text-zinc-500">
          {onlyUnreplied ? (
            <>
              {visibleLeads.length} не ответили из {total}{" "}
              {pluralize(total, "канала", "каналов", "каналов")}
            </>
          ) : onlyRejected ? (
            <>
              {visibleLeads.length} отбракованных из {total}{" "}
              {pluralize(total, "канала", "каналов", "каналов")}
            </>
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
          visibleLeads.length === 0 && (
            <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
              {onlyRejected
                ? "Отбракованных нет — все каналы годны к отправке."
                : "Все ответили — фильтр пуст."}
            </div>
          )}
        {leadsQ.data && leadsQ.data.leads.length === LEADS_PAGE_LIMIT && (
          <TruncationBanner
            shown={LEADS_PAGE_LIMIT}
            total={leadsQ.data.total}
            entity="каналов"
          />
        )}
        {scheduleNew.data?.scheduled === 0 && (
          <p className="text-xs text-zinc-500">
            Новых отправок не получилось: эти админы уже контактированы или
            опенер им не адресуется (бот/ручной способ связи).
          </p>
        )}
        {scheduleNew.error && (
          <p className="text-xs text-red-600">
            {errorMessage(scheduleNew.error)}
          </p>
        )}
        {onlyRejected && noContactTotal > 0 && (
          // «Без контакта» — половина отбраковки, чинится резолвером. Вход в
          // тот же prep-инбокс, что и из draft (no-РКН вернётся сам при синке).
          <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-2 text-sm text-zinc-600">
            <span>
              {noContactTotal}{" "}
              {pluralize(noContactTotal, "канал", "канала", "каналов")} без
              контакта — найдите контакт, и опенер уйдёт автоматически.
            </span>
            <button
              type="button"
              onClick={openResolver}
              className="shrink-0 font-medium text-emerald-700 hover:underline"
            >
              Найти контакты →
            </button>
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
                      {l.channel?.title ||
                        (l.channel?.username ? `@${l.channel.username}` : "—")}
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
                    {l.contactReady ? (
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
                  onRemoved={() => setPrepLeadId(null)}
                />
              )}
            </div>
          </div>
        )}
        {leadsQ.data && visibleLeads.length > 0 && !showPrepInbox && (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="sticky left-0 bg-zinc-50 px-4 py-2 text-left font-normal">
                    Канал
                  </th>
                  <th className="px-4 py-2 text-left font-normal">Аккаунт</th>
                  {Array.from({ length: totalMsgCount }).map((_, i) => (
                    <th key={i} className="px-4 py-2 text-left font-normal">
                      {i === 0 ? "Первое" : `Сообщение ${i + 1}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setDrawerLeadId(l.id)}
                    className={
                      "group cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 " +
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
                    {Array.from({ length: totalMsgCount }).map((_, idx) => {
                      const msg = l.messages.find((m) => m.messageIdx === idx);
                      return (
                        <td key={idx} className="px-4 py-2 align-top">
                          <MessageStatusCell
                            msg={msg}
                            repliedAt={l.repliedAt}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
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
        />
      )}
      {showAddChannels && (
        <AddChannelsModal
          wsId={wsId}
          projectId={projectId}
          onClose={() => setShowAddChannels(false)}
          onAdded={() => invalidateProject(qc, wsId, projectId, { leads: true })}
          outreach={
            canPrep && seq.data
              ? {
                  status: seq.data.status as "active" | "paused",
                  hot: leadsQ.data?.outreachHot ?? false,
                }
              : undefined
          }
        />
      )}
    </div>
  );
}


function LeadCell({
  lead,
  wsId,
  canSkip,
  onToggleSkip,
}: {
  lead: Lead;
  wsId: string;
  // Исключение из рассылки доступно в active/paused (в draft лида удаляют).
  canSkip: boolean;
  onToggleSkip: () => void;
}) {
  const ch = lead.channel;
  const channelLabel =
    ch?.title || (ch?.username ? `@${ch.username}` : "—");
  const admin = lead.username ? `@${lead.username}` : null;
  const toggleSkip = (e: React.MouseEvent) => {
    e.stopPropagation(); // клик по строке открывает drawer
    onToggleSkip();
  };
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2">
        <span className="font-medium">{channelLabel}</span>
        {ch && (
          <ChannelBadges
            username={ch.username}
            link={ch.link}
            isRkn={ch.isRkn}
            memberCount={ch.memberCount}
          />
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
      </div>
      {admin && (
        <div className="text-xs text-zinc-500" title="Админ-получатель аутрича">
          админ {admin}
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
      {lead.contactReady && ch?.alreadyWorking && (
        // Уже работает у нас на платформе (CPC/CPA) — партнёра не питчим.
        <div>
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">
            уже работает
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


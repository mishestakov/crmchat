import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  MessageCircleReply,
  Plus,
  Sparkles,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import { type AccountRow } from "../../../../../../components/chat-drawer";
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
  // ?filter=no-contact — переход из чек-листа запуска (LaunchPanel).
  validateSearch: (search: Record<string, unknown>): { filter?: "no-contact" } => ({
    filter: search.filter === "no-contact" ? "no-contact" : undefined,
  }),
});

const LEADS_PAGE_LIMIT = 1000;

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];
type LeadMessage = Lead["messages"][number];

function LeadsPage() {
  const { wsId, projectId } = Route.useParams();
  const { filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const onlyNoContact = filter === "no-contact";
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);
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
    if (onlyNoContact) {
      out = out.filter((l) => !l.contactReady);
    }
    return out;
  }, [leadsQ.data, onlyUnreplied, onlyNoContact]);

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
  const prepLead = isDraft
    ? (visibleLeads.find((l) => l.id === prepLeadId) ??
      visibleLeads.find((l) => !l.contactReady) ??
      visibleLeads[0])
    : undefined;

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
          {!isDraft && (
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={onlyUnreplied}
                onChange={(e) => setOnlyUnreplied(e.target.checked)}
              />
              Только не ответившие
            </label>
          )}
          {isDraft && (
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={onlyNoContact}
                onChange={(e) =>
                  navigate({
                    search: {
                      filter: e.target.checked ? "no-contact" : undefined,
                    },
                    replace: true,
                  })
                }
              />
              Только без контакта
            </label>
          )}
        </div>

        <div className="text-xs text-zinc-500">
          {onlyUnreplied ? (
            <>
              {visibleLeads.length} не ответили из {total}{" "}
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
              Все ответили — фильтр пуст.
            </div>
          )}
        {leadsQ.data && leadsQ.data.leads.length === LEADS_PAGE_LIMIT && (
          <TruncationBanner
            shown={LEADS_PAGE_LIMIT}
            total={leadsQ.data.total}
            entity="каналов"
          />
        )}
        {leadsQ.data && visibleLeads.length > 0 && isDraft && (
          // Инбокс подготовки (D1, как агентский лонглист): слева компактный
          // список, справа канал + резолвер выбранного. Поточная обработка —
          // удалил/нашёл контакт → фокус сам уходит к следующему проблемному.
          <div className="flex h-[calc(100vh-300px)] min-h-[420px] overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="w-72 shrink-0 overflow-y-auto border-r border-zinc-200">
              {visibleLeads.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setPrepLeadId(l.id)}
                  className={
                    "block w-full border-b border-zinc-100 px-3 py-2 text-left " +
                    (l.id === prepLead?.id ? "bg-emerald-50" : "hover:bg-zinc-50")
                  }
                >
                  <div className="truncate text-sm font-medium text-zinc-900">
                    {l.channel?.title ||
                      (l.channel?.username ? `@${l.channel.username}` : "—")}
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
        {leadsQ.data && visibleLeads.length > 0 && !isDraft && (
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
                      "cursor-pointer border-t border-zinc-100 hover:bg-zinc-50 " +
                      (l.repliedAt ? "bg-emerald-50/40" : "")
                    }
                  >
                    <td
                      className="sticky left-0 px-4 py-2 align-top"
                      style={{ background: "inherit" }}
                    >
                      <LeadCell lead={l} wsId={wsId} />
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
        />
      )}
    </div>
  );
}


function LeadCell({ lead, wsId }: { lead: Lead; wsId: string }) {
  const ch = lead.channel;
  const channelLabel =
    ch?.title || (ch?.username ? `@${ch.username}` : "—");
  const admin = lead.username ? `@${lead.username}` : null;
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{channelLabel}</div>
      {admin && (
        <div className="text-xs text-zinc-500" title="Админ-получатель аутрича">
          админ {admin}
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
  if (/PEER_FLOOD/i.test(raw)) return "Аккаунт зарезан TG";
  if (/USER_DEACTIVATED|INPUT_USER_DEACTIVATED/i.test(raw)) return "Аккаунт удалён";
  if (/CHAT_WRITE_FORBIDDEN/i.test(raw)) return "Писать запрещено";
  if (/PHONE_NOT_SUPPORTED/i.test(raw)) return "Только @username";
  if (/Bot can't initiate conversation/i.test(raw)) return "Бот не пишет первым";
  if (/MESSAGE_EMPTY|MESSAGE_TOO_LONG/i.test(raw)) return "Длина сообщения";
  if (/send update lost/i.test(raw)) return "Подтверждение потеряно";
  return "Ошибка";
}


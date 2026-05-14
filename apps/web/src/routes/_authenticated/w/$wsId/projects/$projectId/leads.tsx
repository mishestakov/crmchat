import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  MessageCircleReply,
  Sparkles,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { type AccountRow } from "../../../../../../components/chat-drawer";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import {
  formatDateTime,
  formatRelative,
  pluralize,
} from "../../../../../../lib/date-utils";
import {
  useOutreachAccounts,
  useProject,
} from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/projects/$projectId/leads",
)({
  component: LeadsPage,
});

const LEADS_PAGE_LIMIT = 1000;

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];
type LeadMessage = Lead["messages"][number];

function LeadsPage() {
  const { wsId, projectId } = Route.useParams();
  const [showCsv, setShowCsv] = useState(false);
  const [onlyUnreplied, setOnlyUnreplied] = useState(false);
  const [importFilter, setImportFilter] = useState<string>("all");
  const [drawerLeadId, setDrawerLeadId] = useState<string | null>(null);

  const seq = useProject(wsId, projectId);
  const accountsQ = useOutreachAccounts(wsId);
  const isDraftStatus = seq.data?.status === "draft";

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

  const importsQ = useQuery({
    queryKey: ["project-imports", wsId, projectId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/imports",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // Колонки CSV-данных = объединение ключей properties по всем лидам.
  // Стабильный порядок: первое появление wins.
  const csvKeys = useMemo(() => {
    if (!leadsQ.data) return [] as string[];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of leadsQ.data.leads) {
      for (const k of Object.keys(l.properties)) {
        if (!seen.has(k)) {
          seen.add(k);
          out.push(k);
        }
      }
    }
    return out;
  }, [leadsQ.data]);

  const totalMsgCount = seq.data?.messages.length ?? 0;
  const total = leadsQ.data?.total ?? 0;
  const replied = leadsQ.data?.repliedCount ?? 0;
  const visibleLeads = useMemo(() => {
    if (!leadsQ.data) return [];
    let out = leadsQ.data.leads;
    if (importFilter !== "all") {
      out = out.filter((l) => l.importId === importFilter);
    }
    if (onlyUnreplied) {
      out = out.filter((l) => !l.repliedAt);
    }
    return out;
  }, [leadsQ.data, onlyUnreplied, importFilter]);

  // Per-import счётчики для опций селекта — «N в работе» = всего лидов
  // импорта на этой странице (server-side total приходит в importStats,
  // но фильтр клиентский, так что считаем по leadsQ.data).
  const importCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!leadsQ.data) return m;
    for (const l of leadsQ.data.leads) {
      if (!l.importId) continue;
      m.set(l.importId, (m.get(l.importId) ?? 0) + 1);
    }
    return m;
  }, [leadsQ.data]);
  // Сводка по выбранной странице (200 лидов); при больших задачах нужен
  // агрегат с бэка.
  const stickyCount =
    leadsQ.data?.leads.filter((l) => l.accountSource === "sticky").length ?? 0;
  const unassignedCount =
    leadsQ.data?.leads.filter(
      (l) => l.accountSource === null && l.account === null,
    ).length ?? 0;
  const isDraft = isDraftStatus;

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Контакты</h1>
          <div className="flex items-center gap-3">
            {importsQ.data && importsQ.data.length > 1 && (
              <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
                Импорт:
                <select
                  value={importFilter}
                  onChange={(e) => setImportFilter(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
                >
                  <option value="all">Все ({leadsQ.data?.total ?? 0})</option>
                  {importsQ.data.map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {imp.name} · {formatRelative(imp.createdAt)}
                      {importCounts.get(imp.id)
                        ? ` · ${importCounts.get(imp.id)}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={onlyUnreplied}
                onChange={(e) => setOnlyUnreplied(e.target.checked)}
              />
              Только не ответившие
            </label>
            {csvKeys.length > 0 && (
              <label className="inline-flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  checked={showCsv}
                  onChange={(e) => setShowCsv(e.target.checked)}
                />
                Показать CSV-данные
              </label>
            )}
            <Link
              to="/w/$wsId/projects/$projectId/kanban"
              params={{ wsId, projectId }}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              Канбан →
            </Link>
            {seq.data?.status !== "done" && (
              <Link
                to="/w/$wsId/projects/$projectId/import"
                params={{ wsId, projectId }}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                + Подлить CSV
              </Link>
            )}
          </div>
        </div>

        <div className="text-xs text-zinc-500">
          {onlyUnreplied ? (
            <>
              {visibleLeads.length} не ответили из {total}{" "}
              {pluralize(total, "лида", "лидов", "лидов")}
            </>
          ) : (
            <>
              Всего {total} {pluralize(total, "лид", "лида", "лидов")}
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
            Загрузка лидов…
          </div>
        )}
        {leadsQ.error && (
          <div className="rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
            {errorMessage(leadsQ.error)}
          </div>
        )}
        {leadsQ.data && leadsQ.data.leads.length === 0 && (
          <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
            В исходном списке нет лидов.
          </div>
        )}
        {leadsQ.data &&
          leadsQ.data.leads.length > 0 &&
          visibleLeads.length === 0 && (
            <div className="rounded-2xl bg-white p-6 text-sm text-zinc-500 shadow-sm">
              {importFilter !== "all" && onlyUnreplied
                ? "В этом импорте все ответили."
                : importFilter !== "all"
                  ? "В этом импорте лидов нет на текущей странице."
                  : "Все ответили — фильтр пуст."}
            </div>
          )}
        {leadsQ.data && leadsQ.data.leads.length === LEADS_PAGE_LIMIT && (
          <TruncationBanner
            shown={LEADS_PAGE_LIMIT}
            total={leadsQ.data.total}
            entity="лидов"
          />
        )}
        {leadsQ.data && visibleLeads.length > 0 && (
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="sticky left-0 bg-zinc-50 px-4 py-2 text-left font-normal">
                    Лид
                  </th>
                  {showCsv &&
                    csvKeys.map((k) => (
                      <th key={k} className="px-4 py-2 text-left font-normal">
                        {k}
                      </th>
                    ))}
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
                    onClick={
                      isDraftStatus ? undefined : () => setDrawerLeadId(l.id)
                    }
                    className={
                      "border-t border-zinc-100 " +
                      (isDraftStatus ? "" : "cursor-pointer hover:bg-zinc-50 ") +
                      (l.repliedAt ? "bg-emerald-50/40" : "")
                    }
                  >
                    <td
                      className="sticky left-0 px-4 py-2 align-top"
                      style={{ background: "inherit" }}
                    >
                      <LeadCell lead={l} wsId={wsId} />
                    </td>
                    {showCsv &&
                      csvKeys.map((k) => (
                        <td
                          key={k}
                          className="px-4 py-2 align-top text-xs text-zinc-700"
                        >
                          {l.properties[k] ?? (
                            <span className="text-zinc-400">—</span>
                          )}
                        </td>
                      ))}
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
      {drawerLeadId &&
        (() => {
          const lead = visibleLeads.find((l) => l.id === drawerLeadId);
          if (!lead) return null;
          return (
            <LeadChatDrawer
              wsId={wsId}
              lead={lead}
              accounts={accountsQ.data ?? []}
              onClose={() => setDrawerLeadId(null)}
            />
          );
        })()}
    </div>
  );
}


function LeadCell({ lead, wsId }: { lead: Lead; wsId: string }) {
  const ident = lead.username ? `@${lead.username}` : "—";
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{ident}</div>
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
        label={`Ответил ${formatRelative(repliedAt)}`}
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
    const when = msg.scheduledAt
      ? formatRelative(msg.scheduledAt, { future: true })
      : "позже";
    return <span className="text-xs text-zinc-500">{when}</span>;
  }
  // sent
  if (msg.readAt) {
    return (
      <StatusBadge
        icon={<CheckCheck size={12} />}
        color="blue"
        title={`Прочитано ${formatDateTime(msg.readAt)}`}
        label={`Прочитано ${formatRelative(msg.readAt)}`}
      />
    );
  }
  return (
    <StatusBadge
      icon={<Check size={12} />}
      color="zinc"
      title={`Отправлено ${formatDateTime(msg.sentAt ?? "")}`}
      label={`Отправлено ${formatRelative(msg.sentAt ?? "")}`}
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


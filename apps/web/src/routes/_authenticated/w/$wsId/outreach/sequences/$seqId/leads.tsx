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
import { api } from "../../../../../../../lib/api";
import { errorMessage } from "../../../../../../../lib/errors";
import { BackButton } from "../../../../../../../components/back-button";
import {
  formatDateTime,
  formatRelative,
  pluralize,
} from "../../../../../../../lib/date-utils";
import { useSequence } from "../../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../../lib/query-keys";

// Лиды + per-message статусы. По донор-стилю — по колонке на каждое сообщение
// sequence, в каждой ячейке иконка ✓ / ✓✓ / 💬 / ✗ + дата. Toggle «Показать
// CSV-данные» раскрывает дополнительные колонки из CSV-properties.

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/$seqId/leads",
)({
  component: LeadsPage,
});

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/outreach/sequences/{seqId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];
type LeadMessage = Lead["messages"][number];

function LeadsPage() {
  const { wsId, seqId } = Route.useParams();
  const [showCsv, setShowCsv] = useState(false);

  const seq = useSequence(wsId, seqId);

  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/leads",
        {
          params: { path: { wsId, seqId }, query: { limit: 200, offset: 0 } },
        },
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

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Детали кампании</h1>
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
        </div>

        <div className="text-xs text-zinc-500">
          Всего {total} {pluralize(total, "лид", "лида", "лидов")}
          {replied > 0 && ` · ${replied} ответили`}
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
        {leadsQ.data && leadsQ.data.leads.length > 0 && (
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
                {leadsQ.data.leads.map((l) => (
                  <tr
                    key={l.id}
                    className={
                      "border-t border-zinc-100 " +
                      (l.repliedAt ? "bg-emerald-50/40" : "")
                    }
                  >
                    <td className="sticky left-0 bg-white px-4 py-2 align-top">
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
                      <AccountCell account={l.account} />
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
    </div>
  );
}

function LeadCell({ lead, wsId }: { lead: Lead; wsId: string }) {
  const ident = lead.username ? `@${lead.username}` : lead.phone ?? "—";
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{ident}</div>
      {lead.repliedAt && lead.contactId && (
        <Link
          to="/w/$wsId/contacts/$id"
          params={{ wsId, id: lead.contactId }}
          className="text-xs text-emerald-700 hover:underline"
        >
          → контакт
        </Link>
      )}
    </div>
  );
}

function AccountCell({ account }: { account: Lead["account"] }) {
  if (!account) return <span className="text-xs text-zinc-400">—</span>;
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex items-center gap-1 font-medium text-zinc-800">
        {account.firstName ?? "—"}
        {account.hasPremium && (
          <Sparkles size={10} className="text-amber-500" />
        )}
      </div>
      <div className="text-zinc-500">
        {account.tgUsername ? `@${account.tgUsername}` : ""}
        {account.tgUsername && account.phoneNumber ? " · " : ""}
        {account.phoneNumber ?? ""}
      </div>
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
    return (
      <StatusBadge
        icon={<AlertCircle size={12} />}
        color="red"
        title={msg.error ?? "Ошибка отправки"}
        label="Ошибка"
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


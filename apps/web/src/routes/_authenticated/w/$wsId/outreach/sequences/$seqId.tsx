import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/$seqId",
)({
  component: SequenceDetailPage,
});

type SequenceData =
  paths["/v1/workspaces/{wsId}/outreach/sequences/{seqId}"]["get"]["responses"][200]["content"]["application/json"];
type Message = SequenceData["messages"][number];

function newMessage(): Message {
  return {
    // Простой client-side id; backend его сохраняет в jsonb как есть.
    id: Math.random().toString(36).slice(2, 10),
    text: "",
    delay: { period: "hours", value: 0 },
  };
}

function SequenceDetailPage() {
  const { wsId, seqId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useQuery({
    queryKey: OUTREACH_QK.sequence(wsId, seqId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const accounts = useQuery({
    queryKey: OUTREACH_QK.accounts(wsId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/accounts",
        { params: { path: { wsId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/leads",
        {
          params: {
            path: { wsId, seqId },
            query: { limit: 100, offset: 0 },
          },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  // SSE-канал апдейтов sequence: воркер/listener эмитят на каждое
  // sent/failed/cancelled/replied — фронт инвалидирует кэш, TanStack
  // перетягивает leads endpoint. Ноль-секундная реакция вместо 5s polling'а.
  // EventSource сам ре-коннектит на close, ничего не нужно дополнительно.
  //
  // Открываем только для active/paused — в draft и completed события не
  // прилетят, незачем держать idle-коннект (реверс-проксям/серверу всё
  // равно лишняя работа).
  const seqStatus = seq.data?.status;
  const needsLiveUpdates = seqStatus === "active" || seqStatus === "paused";
  useEffect(() => {
    if (!needsLiveUpdates) return;
    const url = `/v1/workspaces/${wsId}/outreach/sequences/${seqId}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    const onChange = () => {
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId),
      });
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.sequence(wsId, seqId),
      });
    };
    es.addEventListener("changed", onChange);
    return () => {
      es.removeEventListener("changed", onChange);
      es.close();
    };
  }, [wsId, seqId, qc, needsLiveUpdates]);

  const [name, setName] = useState("");
  const [accountsMode, setAccountsMode] = useState<"all" | "selected">("all");
  const [accountsSelected, setAccountsSelected] = useState<string[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Hydrate local editor state из server-data при загрузке/refetch.
  // useQuery.data ссылается на новый объект после каждого refetch, поэтому
  // вешаем effect на seq.data — без `dirty`-флага простая стратегия: server
  // всегда побеждает (editor только в draft, конфликтов нет).
  useEffect(() => {
    if (!seq.data) return;
    setName(seq.data.name);
    setAccountsMode(seq.data.accountsMode);
    setAccountsSelected(seq.data.accountsSelected);
    setMessages(seq.data.messages);
  }, [seq.data]);

  const isDraft = seq.data?.status === "draft";
  const isActive = seq.data?.status === "active";
  const isPaused = seq.data?.status === "paused";

  const activeAccounts = useMemo(
    () => (accounts.data ?? []).filter((a) => a.status === "active"),
    [accounts.data],
  );

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        {
          params: { path: { wsId, seqId } },
          body: {
            name: name.trim(),
            accountsMode,
            accountsSelected,
            messages,
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
    },
  });

  const activate = useMutation({
    mutationFn: async () => {
      // Сохраним последние правки editor'а перед активацией.
      await save.mutateAsync();
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/activate",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId),
      });
    },
  });

  const pause = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/pause",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
    },
  });

  const resume = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/resume",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequences(wsId) });
      navigate({ to: "/w/$wsId/outreach/sequences", params: { wsId } });
    },
  });

  if (seq.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-3xl text-sm">Загрузка…</p>
      </div>
    );
  }
  if (seq.error || !seq.data) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <p className="mx-auto max-w-3xl text-red-600">
          {seq.error ? errorMessage(seq.error) : "Рассылка не найдена"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <BackButton />
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold">{seq.data.name}</h1>
            <StatusBadge status={seq.data.status} />
          </div>
          <div className="flex shrink-0 gap-2">
            {isDraft && (
              <button
                type="button"
                onClick={() => activate.mutate()}
                disabled={activate.isPending || messages.length === 0}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Play size={14} /> Запустить
              </button>
            )}
            {isActive && (
              <button
                type="button"
                onClick={() => pause.mutate()}
                disabled={pause.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-800 hover:bg-amber-50 disabled:opacity-50"
              >
                <Pause size={14} /> Пауза
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Play size={14} /> Возобновить
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (confirm(`Удалить рассылку «${seq.data!.name}»?`)) {
                  remove.mutate();
                }
              }}
              disabled={remove.isPending}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Удалить
            </button>
          </div>
        </div>

        {(activate.error || pause.error || resume.error || save.error) && (
          <p className="text-sm text-red-600">
            {errorMessage(
              activate.error ?? pause.error ?? resume.error ?? save.error,
            )}
          </p>
        )}

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-600">Название</span>
            <input
              type="text"
              value={name}
              disabled={!isDraft}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
            />
          </label>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <div className="text-sm font-medium">Аккаунты</div>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={accountsMode === "all"}
                disabled={!isDraft}
                onChange={() => setAccountsMode("all")}
              />
              <span>
                Все активные ({activeAccounts.length}{" "}
                {pluralize(activeAccounts.length, "аккаунт", "аккаунта", "аккаунтов")})
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={accountsMode === "selected"}
                disabled={!isDraft}
                onChange={() => setAccountsMode("selected")}
              />
              <span>Выбранные</span>
            </label>
          </div>
          {accountsMode === "selected" && (
            <div className="space-y-1.5 pl-5">
              {activeAccounts.length === 0 && (
                <p className="text-xs text-amber-700">
                  Нет активных outreach-аккаунтов. Добавьте их в разделе
                  «Аккаунты».
                </p>
              )}
              {activeAccounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={accountsSelected.includes(a.id)}
                    disabled={!isDraft}
                    onChange={(e) => {
                      setAccountsSelected((prev) =>
                        e.target.checked
                          ? [...prev, a.id]
                          : prev.filter((id) => id !== a.id),
                      );
                    }}
                  />
                  <span className="text-zinc-700">
                    {a.firstName ?? "—"}
                    {a.tgUsername ? ` @${a.tgUsername}` : ""}
                    {a.phoneNumber ? ` · ${a.phoneNumber}` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Сообщения</div>
            {isDraft && (
              <button
                type="button"
                onClick={() => setMessages((prev) => [...prev, newMessage()])}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
              >
                <Plus size={14} /> Добавить сообщение
              </button>
            )}
          </div>
          {messages.length === 0 && (
            <p className="text-xs text-zinc-500">
              Пока ни одного сообщения. Добавьте первое — оно отправится сразу
              после запуска рассылки.
            </p>
          )}
          {messages.map((m, idx) => (
            <div
              key={m.id}
              className="rounded-lg border border-zinc-200 p-3 space-y-2"
            >
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>
                  Сообщение {idx + 1}
                  {idx === 0 ? " (отправляется сразу)" : ""}
                </span>
                {isDraft && (
                  <button
                    type="button"
                    onClick={() =>
                      setMessages((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="text-zinc-400 hover:text-red-600"
                    aria-label="Удалить сообщение"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {idx > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">Через</span>
                  <input
                    type="number"
                    min={0}
                    value={m.delay.value}
                    disabled={!isDraft}
                    onChange={(e) =>
                      setMessages((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                delay: {
                                  ...x.delay,
                                  value: Math.max(
                                    0,
                                    Number(e.target.value) || 0,
                                  ),
                                },
                              }
                            : x,
                        ),
                      )
                    }
                    className="w-16 rounded-md border border-zinc-300 px-2 py-1 disabled:bg-zinc-50"
                  />
                  <select
                    value={m.delay.period}
                    disabled={!isDraft}
                    onChange={(e) =>
                      setMessages((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                delay: {
                                  ...x.delay,
                                  period: e.target.value as Message["delay"]["period"],
                                },
                              }
                            : x,
                        ),
                      )
                    }
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 disabled:bg-zinc-50"
                  >
                    <option value="minutes">минут</option>
                    <option value="hours">часов</option>
                    <option value="days">дней</option>
                  </select>
                  <span className="text-zinc-500">после предыдущего</span>
                </div>
              )}
              <textarea
                value={m.text}
                disabled={!isDraft}
                rows={4}
                placeholder="Привет, {{username}}! ..."
                onChange={(e) =>
                  setMessages((prev) =>
                    prev.map((x, i) =>
                      i === idx ? { ...x, text: e.target.value } : x,
                    ),
                  )
                }
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500"
              />
            </div>
          ))}
          <p className="text-xs text-zinc-500">
            Подстановки:{" "}
            <code>{"{{username}}"}</code>, <code>{"{{phone}}"}</code> и любые
            ключи из колонок CSV / properties контакта.
          </p>
          {isDraft && (
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {save.isPending ? "Сохраняем…" : "Сохранить черновик"}
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
            <div className="text-sm font-medium">Лиды</div>
            {leadsQ.data && (
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span>Всего {leadsQ.data.total}</span>
                {leadsQ.data.repliedCount > 0 && (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <MessageSquare size={12} /> {leadsQ.data.repliedCount} ответили
                  </span>
                )}
              </div>
            )}
          </div>
          {leadsQ.isLoading && (
            <p className="px-5 py-4 text-sm text-zinc-500">Загрузка лидов…</p>
          )}
          {leadsQ.error && (
            <p className="px-5 py-4 text-sm text-red-600">
              {errorMessage(leadsQ.error)}
            </p>
          )}
          {leadsQ.data && leadsQ.data.leads.length === 0 && (
            <p className="px-5 py-4 text-sm text-zinc-500">
              В исходном списке нет лидов.
            </p>
          )}
          {leadsQ.data && leadsQ.data.leads.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-5 py-2 text-left font-normal">Лид</th>
                  <th className="px-5 py-2 text-left font-normal">Прогресс</th>
                  <th className="px-5 py-2 text-left font-normal">Дальше</th>
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
                    <td className="px-5 py-2">
                      {l.username ? (
                        <span>@{l.username}</span>
                      ) : l.phone ? (
                        <span>{l.phone}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs">
                      {l.repliedAt ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <MessageSquare size={12} /> ответил{" "}
                          {formatRelative(l.repliedAt)}
                        </span>
                      ) : (
                        <ProgressCell
                          sent={l.sentCount}
                          total={l.totalCount}
                          hasFailed={l.hasFailed}
                        />
                      )}
                    </td>
                    <td className="px-5 py-2 text-xs text-zinc-500">
                      {l.repliedAt ? (
                        l.contactId ? (
                          <Link
                            to="/w/$wsId/contacts/$id"
                            params={{ wsId, id: l.contactId }}
                            className="text-emerald-700 hover:underline"
                          >
                            → контакт
                          </Link>
                        ) : (
                          "—"
                        )
                      ) : l.nextSendAt ? (
                        formatNextSend(l.nextSendAt)
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {leadsQ.data && leadsQ.data.total > leadsQ.data.leads.length && (
            <p className="border-t border-zinc-100 px-5 py-3 text-xs text-zinc-500">
              Показано {leadsQ.data.leads.length} из {leadsQ.data.total}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Черновик", cls: "bg-zinc-100 text-zinc-700" },
    active: { label: "Идёт", cls: "bg-emerald-100 text-emerald-700" },
    paused: { label: "Пауза", cls: "bg-amber-100 text-amber-800" },
    completed: { label: "Завершена", cls: "bg-zinc-100 text-zinc-500" },
  };
  const m = map[status] ?? { label: status, cls: "bg-zinc-100" };
  return (
    <span
      className={"mt-1 inline-block rounded-full px-2 py-0.5 text-xs " + m.cls}
    >
      {m.label}
    </span>
  );
}

function ProgressCell({
  sent,
  total,
  hasFailed,
}: {
  sent: number;
  total: number;
  hasFailed: boolean;
}) {
  if (sent >= total && total > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <CheckCircle2 size={12} /> {sent}/{total}
      </span>
    );
  }
  return (
    <span
      className={
        "inline-flex items-center gap-1 " +
        (hasFailed ? "text-red-700" : "text-zinc-700")
      }
    >
      {hasFailed ? <XCircle size={12} /> : <Send size={12} />}
      {sent}/{total}
    </span>
  );
}

function formatNextSend(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return `сегодня в ${time}`;
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
  }) + ` в ${time}`;
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec} сек назад`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ч назад`;
  const day = Math.floor(hr / 24);
  return `${day} дн назад`;
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Eye,
  MessageSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../../lib/api";
import { errorMessage } from "../../../../../../../lib/errors";
import { BackButton } from "../../../../../../../components/back-button";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
} from "../../../../../../../components/section";
import { pluralize } from "../../../../../../../lib/date-utils";
import { useSequence } from "../../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../../lib/query-keys";
import { substituteVariables } from "../../../../../../../lib/substitute-variables";

// Sequence detail — главный экран. Структура донора:
//   Section "детали": Название (inline edit) → Статус (с кнопкой Pause/Play
//     справа) → Аккаунты (Link → ./accounts) → Лиды (Link → ./leads)
//   Section "статистика": клик по карточкам открывает Dialog с фильтрами
//   Section "кампания": Timeline сообщений (clic = inline editor)
//   Внизу: Удалить рассылку (через подтверждение).

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/outreach/sequences/$seqId/",
)({
  component: SequenceDetailPage,
});

type SequenceData =
  paths["/v1/workspaces/{wsId}/outreach/sequences/{seqId}"]["get"]["responses"][200]["content"]["application/json"];
type Message = SequenceData["messages"][number];

function newMessage(): Message {
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: "",
    delay: { period: "hours", value: 0 },
  };
}

function SequenceDetailPage() {
  const { wsId, seqId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useSequence(wsId, seqId);

  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/leads",
        {
          params: { path: { wsId, seqId }, query: { limit: 1, offset: 0 } },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const analyticsQ = useQuery({
    queryKey: OUTREACH_QK.sequenceAnalytics(wsId, seqId, 30),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/analytics",
        { params: { path: { wsId, seqId }, query: { period: 30 } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // SSE-канал апдейтов sequence — invalidate всех зависимых query.
  const seqStatus = seq.data?.status;
  const needsLiveUpdates = seqStatus === "active" || seqStatus === "paused";
  useEffect(() => {
    if (!needsLiveUpdates) return;
    const url = `/v1/workspaces/${wsId}/outreach/sequences/${seqId}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    const onChange = () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId) });
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequence(wsId, seqId) });
      qc.invalidateQueries({
        queryKey: ["outreach-sequence-analytics", wsId, seqId],
        // partial-key match — accordion'и в dialog'е используют разные period/grouping/viewMode
      });
    };
    es.addEventListener("changed", onChange);
    return () => {
      es.removeEventListener("changed", onChange);
      es.close();
    };
  }, [wsId, seqId, qc, needsLiveUpdates]);

  // Local editor state — name + messages. Accounts/CRM-settings правятся
  // на отдельных sub-routes, тут не редактируются.
  const [name, setName] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    if (!seq.data) return;
    setName(seq.data.name);
    setMessages(seq.data.messages);
  }, [seq.data]);

  const isDraft = seq.data?.status === "draft";
  const isActive = seq.data?.status === "active";
  const isPaused = seq.data?.status === "paused";

  const save = useMutation({
    mutationFn: async (overrides?: { messages?: Message[]; name?: string }) => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}",
        {
          params: { path: { wsId, seqId } },
          body: {
            name: (overrides?.name ?? name).trim(),
            messages: overrides?.messages ?? messages,
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
      await save.mutateAsync(undefined);
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
      qc.invalidateQueries({ queryKey: OUTREACH_QK.sequenceLeads(wsId, seqId) });
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

  const data = seq.data;
  const accountsSummary =
    data.accountsMode === "all"
      ? "Все"
      : `Выбрано: ${data.accountsSelected.length}`;
  const leadsCount = leadsQ.data?.total ?? 0;

  return (
    <div className="flex min-h-full flex-col gap-4 p-6">
      <BackButton />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4">
        <h1 className="truncate text-2xl font-semibold">{data.name}</h1>

        {/* === Section: детали кампании === */}
        <Section>
          <SectionItem>
            <SectionItemTitle>Название</SectionItemTitle>
            <input
              type="text"
              value={name}
              disabled={!isDraft}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (isDraft && name.trim() !== data.name) {
                  save.mutate({ name });
                }
              }}
              className="w-full max-w-xs bg-transparent text-right text-sm placeholder:text-zinc-400 focus:outline-none disabled:text-zinc-500"
            />
          </SectionItem>

          <SectionItem>
            <SectionItemTitle>
              <span className="text-zinc-500">Статус: </span>
              <span className="font-medium">{statusRu(data.status)}</span>
            </SectionItemTitle>
            <SectionItemValue>
              {isActive && (
                <button
                  type="button"
                  onClick={() => pause.mutate()}
                  disabled={pause.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                >
                  <Pause size={12} /> Пауза
                </button>
              )}
              {isPaused && (
                <button
                  type="button"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
                >
                  <Play size={12} /> Продолжить
                </button>
              )}
              {isDraft && (
                <button
                  type="button"
                  onClick={() => activate.mutate()}
                  disabled={activate.isPending || messages.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Play size={12} /> Запустить
                </button>
              )}
            </SectionItemValue>
          </SectionItem>

          <Link
            to="/w/$wsId/outreach/sequences/$seqId/accounts"
            params={{ wsId, seqId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>Аккаунты</SectionItemTitle>
              <SectionItemValue>{accountsSummary}</SectionItemValue>
            </SectionItem>
          </Link>

          <Link
            to="/w/$wsId/outreach/sequences/$seqId/contact-settings"
            params={{ wsId, seqId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>CRM-автоматизации</SectionItemTitle>
              <SectionItemValue>—</SectionItemValue>
            </SectionItem>
          </Link>

          <Link
            to="/w/$wsId/outreach/sequences/$seqId/leads"
            params={{ wsId, seqId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>Детали кампании</SectionItemTitle>
              <SectionItemValue>
                {leadsCount} {pluralize(leadsCount, "лид", "лида", "лидов")}
              </SectionItemValue>
            </SectionItem>
          </Link>
        </Section>

        {/* === Section: статистика — для всех статусов кроме draft === */}
        {!isDraft && (
          <Section header="Статистика">
            {analyticsQ.isLoading && (
              <div className="px-5 py-6 text-sm text-zinc-500">Загрузка…</div>
            )}
            {analyticsQ.error && (
              <div className="px-5 py-6 text-sm text-red-600">
                {errorMessage(analyticsQ.error)}
              </div>
            )}
            {analyticsQ.data && (
              <button
                type="button"
                onClick={() => setShowAnalytics(true)}
                className="block w-full text-left hover:bg-zinc-50"
              >
                <div className="grid grid-cols-3 gap-2 px-5 py-4">
                  <StatPill
                    icon={<Check size={14} className="text-zinc-500" />}
                    label="Отправлено"
                    value={analyticsQ.data.totalSent}
                  />
                  <StatPill
                    icon={<CheckCheck size={14} className="text-blue-500" />}
                    label="Прочитано"
                    value={analyticsQ.data.totalRead}
                    pct={pctOf(
                      analyticsQ.data.totalRead,
                      analyticsQ.data.totalSent,
                    )}
                  />
                  <StatPill
                    icon={
                      <MessageSquare size={14} className="text-emerald-600" />
                    }
                    label="Ответили"
                    value={analyticsQ.data.totalReplied}
                    pct={pctOf(
                      analyticsQ.data.totalReplied,
                      analyticsQ.data.totalSent,
                    )}
                  />
                </div>
                <div className="border-t border-zinc-100 px-5 py-2 text-right text-xs text-emerald-700">
                  Подробнее →
                </div>
              </button>
            )}
          </Section>
        )}

        {/* === Section: кампания (сообщения) === */}
        <Section header="Кампания">
          <div className="px-5 py-4">
            {messages.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Пока ни одного сообщения. Добавьте первое — оно отправится сразу
                после запуска рассылки.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-zinc-200 pl-5">
                {messages.map((m, idx) => (
                  <li key={m.id} className="relative">
                    <div className="absolute -left-[26px] top-2 h-3 w-3 rounded-full border-2 border-zinc-300 bg-white" />
                    {editingMessageId === m.id ? (
                      <MessageEditor
                        message={m}
                        index={idx}
                        canEditDelay={idx > 0}
                        onCancel={() => setEditingMessageId(null)}
                        onSave={(updated) => {
                          const next = messages.map((x) =>
                            x.id === updated.id ? updated : x,
                          );
                          setMessages(next);
                          setEditingMessageId(null);
                          save.mutate({ messages: next });
                        }}
                        onPreview={() => setPreviewMsg(m)}
                        onDelete={() => {
                          const next = messages.filter((x) => x.id !== m.id);
                          setMessages(next);
                          setEditingMessageId(null);
                          save.mutate({ messages: next });
                        }}
                      />
                    ) : (
                      <MessageRow
                        message={m}
                        index={idx}
                        editable={isDraft || isPaused}
                        onClick={() => setEditingMessageId(m.id)}
                        onPreview={() => setPreviewMsg(m)}
                      />
                    )}
                  </li>
                ))}
              </ol>
            )}
            {isDraft && !editingMessageId && (
              <button
                type="button"
                onClick={() => {
                  const m = newMessage();
                  setMessages((prev) => [...prev, m]);
                  setEditingMessageId(m.id);
                }}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-800"
              >
                <Plus size={14} /> Добавить сообщение
              </button>
            )}
            {!isDraft && !isPaused && messages.length > 0 && (
              <p className="mt-3 text-xs text-zinc-400">
                Редактирование сообщений доступно в статусе «Черновик» или «Пауза».
              </p>
            )}
          </div>
        </Section>

        {/* === Удалить рассылку === */}
        <div className="mt-auto py-3 text-center">
          <button
            type="button"
            onClick={() => {
              if (isActive) {
                alert("Сначала поставьте рассылку на паузу");
                return;
              }
              setShowDelete(true);
            }}
            className="text-sm text-red-600 hover:text-red-700 hover:underline"
          >
            Удалить рассылку
          </button>
        </div>
      </div>

      {previewMsg && (
        <PreviewDialog
          wsId={wsId}
          seqId={seqId}
          message={previewMsg}
          onClose={() => setPreviewMsg(null)}
        />
      )}

      {showAnalytics && analyticsQ.data && (
        <AnalyticsDialog
          wsId={wsId}
          seqId={seqId}
          onClose={() => setShowAnalytics(false)}
        />
      )}

      {showDelete && (
        <DeleteConfirm
          name={data.name}
          onCancel={() => setShowDelete(false)}
          onConfirm={() => remove.mutate()}
          isPending={remove.isPending}
        />
      )}

      {(activate.error || pause.error || resume.error || save.error || remove.error) && (
        <div className="fixed bottom-4 right-4 max-w-sm rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 shadow-lg">
          {errorMessage(
            activate.error ??
              pause.error ??
              resume.error ??
              save.error ??
              remove.error,
          )}
        </div>
      )}

    </div>
  );
}

const GROUPING_LABELS: Record<"day" | "week" | "month", string> = {
  day: "По дням",
  week: "По неделям",
  month: "По месяцам",
};

function statusRu(status: string): string {
  return (
    {
      draft: "Черновик",
      active: "Идёт",
      paused: "Пауза",
      completed: "Завершена",
    }[status] ?? status
  );
}

function pctOf(num: number, denom: number): number | null {
  if (denom === 0) return null;
  return Math.round((num / denom) * 100);
}

// ─────────────────────── Stats Pill ───────────────────────

function StatPill(props: {
  icon: React.ReactNode;
  label: string;
  value: number;
  pct?: number | null;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        {props.icon}
        <span>{props.label}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {props.value.toLocaleString("ru-RU")}
        </span>
        {props.pct !== null && props.pct !== undefined && (
          <span className="text-xs text-zinc-500">{props.pct}%</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Message Row + Editor ───────────────────────

function MessageRow(props: {
  message: Message;
  index: number;
  editable: boolean;
  onClick: () => void;
  onPreview: () => void;
}) {
  const m = props.message;
  return (
    <div
      role={props.editable ? "button" : undefined}
      onClick={props.editable ? props.onClick : undefined}
      className={
        "rounded-lg border border-zinc-200 bg-white p-3 " +
        (props.editable ? "cursor-pointer hover:border-emerald-300" : "")
      }
    >
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {props.index === 0
            ? "Первое сообщение"
            : `Сообщение ${props.index + 1}, через ${m.delay.value} ${pluralizeDelayPeriod(m.delay)}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onPreview();
            }}
            disabled={!m.text.trim()}
            className="text-zinc-400 hover:text-emerald-700 disabled:opacity-30"
            aria-label="Превью"
            title="Превью с подстановкой переменных"
          >
            <Eye size={14} />
          </button>
          {props.editable && (
            <Pencil size={14} className="text-zinc-400" />
          )}
        </div>
      </div>
      <div className="mt-1 text-sm whitespace-pre-wrap text-zinc-800">
        {m.text || (
          <span className="text-zinc-400 italic">Пустое сообщение</span>
        )}
      </div>
    </div>
  );
}

function MessageEditor(props: {
  message: Message;
  index: number;
  canEditDelay: boolean;
  onCancel: () => void;
  onSave: (m: Message) => void;
  onPreview: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(props.message.text);
  const [delayValue, setDelayValue] = useState(props.message.delay.value);
  const [delayPeriod, setDelayPeriod] = useState(props.message.delay.period);

  return (
    <div className="rounded-lg border border-emerald-300 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>
          {props.index === 0 ? "Первое сообщение" : `Сообщение ${props.index + 1}`}
        </span>
        <button
          type="button"
          onClick={props.onDelete}
          className="text-zinc-400 hover:text-red-600"
          aria-label="Удалить"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {props.canEditDelay && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Через</span>
          <input
            type="number"
            min={0}
            value={delayValue}
            onChange={(e) =>
              setDelayValue(Math.max(0, Number(e.target.value) || 0))
            }
            className="w-16 rounded-md border border-zinc-300 px-2 py-1"
          />
          <select
            value={delayPeriod}
            onChange={(e) => setDelayPeriod(e.target.value as Message["delay"]["period"])}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1"
          >
            <option value="minutes">минут</option>
            <option value="hours">часов</option>
            <option value="days">дней</option>
          </select>
          <span className="text-zinc-500">после предыдущего</span>
        </div>
      )}

      <textarea
        value={text}
        rows={4}
        autoFocus
        placeholder="Привет, {{username}}! ..."
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={props.onPreview}
          disabled={!text.trim()}
          className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          <Eye size={14} /> Превью
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() =>
            props.onSave({
              ...props.message,
              text,
              delay: { value: delayValue, period: delayPeriod },
            })
          }
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}

function pluralizeDelayPeriod(d: Message["delay"]): string {
  if (d.period === "minutes") return pluralize(d.value, "минуту", "минуты", "минут");
  if (d.period === "hours") return pluralize(d.value, "час", "часа", "часов");
  return pluralize(d.value, "день", "дня", "дней");
}

// ─────────────────────── Preview Dialog ───────────────────────

function PreviewDialog(props: {
  wsId: string;
  seqId: string;
  message: Message;
  onClose: () => void;
}) {
  const { wsId, seqId, message } = props;
  const [seed, setSeed] = useState(0);
  const sampleQ = useQuery({
    queryKey: OUTREACH_QK.sampleLead(wsId, seqId, seed),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/sample-lead",
        { params: { path: { wsId, seqId } } },
      );
      if (error) throw error;
      return data;
    },
    refetchOnWindowFocus: false,
    // Без placeholderData каждый «Другой лид» сбрасывает data → блок схлопывается
    // в "Загрузка лида…" и мигает. С placeholderData старый лид остаётся виден
    // пока не приедет новый. isLoading становится isFetching.
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const lead = sampleQ.data;
  const rendered = lead
    ? substituteVariables(message.text, {
        username: lead.username,
        phone: lead.phone,
        properties: lead.properties,
      })
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={props.onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold">Превью сообщения</div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Закрыть"
            className="text-zinc-400 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>
        {sampleQ.isLoading && (
          <p className="text-sm text-zinc-500">Загрузка лида…</p>
        )}
        {sampleQ.error && (
          <p className="text-sm text-red-600">{errorMessage(sampleQ.error)}</p>
        )}
        {sampleQ.data === null && (
          <p className="text-sm text-amber-700">
            В листе нет лидов — превью со значениями недоступно.
          </p>
        )}
        {!sampleQ.isLoading && (
          <>
            {lead && (
              <div className="mb-2 text-xs text-zinc-500">
                Лид:{" "}
                <span className="text-zinc-700">
                  {lead.username
                    ? `@${lead.username}`
                    : lead.phone ?? "без identifier"}
                </span>
              </div>
            )}
            <div className="rounded-lg bg-zinc-50 p-3 text-sm whitespace-pre-wrap">
              {rendered ?? message.text}
            </div>
            {lead && Object.keys(lead.properties).length > 0 && (
              <details className="mt-3 text-xs text-zinc-500">
                <summary className="cursor-pointer">
                  Доступные переменные ({Object.keys(lead.properties).length})
                </summary>
                <ul className="mt-2 space-y-0.5">
                  {Object.entries(lead.properties).map(([k, v]) => (
                    <li key={k} className="font-mono">
                      <span className="text-emerald-700">{`{{${k}}}`}</span>{" "}
                      <span className="text-zinc-700">→ {v}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSeed((s) => s + 1)}
                disabled={sampleQ.data === null || sampleQ.isFetching}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                <RefreshCw
                  size={14}
                  className={sampleQ.isFetching ? "animate-spin" : ""}
                />{" "}
                Другой лид
              </button>
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800"
              >
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Analytics Dialog ───────────────────────

type AnalyticsData =
  paths["/v1/workspaces/{wsId}/outreach/sequences/{seqId}/analytics"]["get"]["responses"][200]["content"]["application/json"];

function AnalyticsDialog(props: {
  wsId: string;
  seqId: string;
  onClose: () => void;
}) {
  const { wsId, seqId } = props;
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [grouping, setGrouping] = useState<"day" | "week" | "month">("day");
  const [viewMode, setViewMode] = useState<"eventDate" | "sendDate">(
    "eventDate",
  );
  const dataQ = useQuery({
    queryKey: OUTREACH_QK.sequenceAnalytics(
      wsId,
      seqId,
      period,
      grouping,
      viewMode,
    ),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/outreach/sequences/{seqId}/analytics",
        {
          params: {
            path: { wsId, seqId },
            query: { period, grouping, viewMode },
          },
        },
      );
      if (error) throw error;
      return data;
    },
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={props.onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-semibold">Аналитика</div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Закрыть"
            className="text-zinc-400 hover:text-zinc-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          <Dropdown
            label="Период"
            value={`${period}д`}
            options={[
              { value: 7, label: "7 дней" },
              { value: 30, label: "30 дней" },
              { value: 90, label: "90 дней" },
            ]}
            onChange={(v) => setPeriod(v as 7 | 30 | 90)}
          />
          <Dropdown
            label="Группировка"
            value={GROUPING_LABELS[grouping]}
            options={[
              { value: "day", label: GROUPING_LABELS.day },
              { value: "week", label: GROUPING_LABELS.week },
              { value: "month", label: GROUPING_LABELS.month },
            ]}
            onChange={(v) => setGrouping(v as "day" | "week" | "month")}
          />
          <Dropdown
            label="Отображать"
            value={
              viewMode === "eventDate" ? "По дате события" : "По дате отправки"
            }
            options={[
              { value: "eventDate", label: "По дате события" },
              { value: "sendDate", label: "По дате отправки" },
            ]}
            onChange={(v) => setViewMode(v as "eventDate" | "sendDate")}
          />
        </div>

        {dataQ.data && <SeriesChart series={dataQ.data.series} />}
      </div>
    </div>
  );
}

function Dropdown<V extends string | number>(props: {
  label: string;
  value: string;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs">
      <span className="text-zinc-500">{props.label}</span>
      <select
        value={String(props.value)}
        onChange={(e) => {
          const opt = props.options.find(
            (o) => String(o.value) === e.target.value,
          );
          if (opt) props.onChange(opt.value);
        }}
        className="bg-transparent text-zinc-800 focus:outline-none"
      >
        {props.options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SeriesChart({ series }: { series: AnalyticsData["series"] }) {
  const maxY = Math.max(1, ...series.map((p) => Math.max(p.sent, p.read, p.replied)));
  const allZero = series.every((p) => p.sent === 0 && p.read === 0 && p.replied === 0);
  if (allZero) {
    return (
      <div className="grid h-48 place-items-center text-sm text-zinc-400">
        Нет данных за выбранный период
      </div>
    );
  }
  const xStep = series.length > 1 ? 100 / (series.length - 1) : 0;
  const toLine = (key: "sent" | "read" | "replied"): string =>
    series
      .map((p, i) => {
        const x = (i * xStep).toFixed(2);
        const y = (40 - (p[key] / maxY) * 40).toFixed(2);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");

  return (
    <div className="space-y-2">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-48 w-full">
        <path d={toLine("sent")} stroke="#71717a" strokeWidth="0.6" fill="none" />
        <path d={toLine("read")} stroke="#3b82f6" strokeWidth="0.6" fill="none" />
        <path d={toLine("replied")} stroke="#10b981" strokeWidth="0.8" fill="none" />
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span>{formatChartDate(series[0]?.date ?? "")}</span>
        <span>
          {formatChartDate(series[series.length - 1]?.date ?? "")} · max {maxY}
        </span>
      </div>
      <div className="flex gap-3 text-xs text-zinc-600">
        <LegendDot color="#71717a" label="отправлено" />
        <LegendDot color="#3b82f6" label="прочитано" />
        <LegendDot color="#10b981" label="ответили" />
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  );
}

function formatChartDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
}

// ─────────────────────── Delete confirm ───────────────────────

function DeleteConfirm(props: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Отмена"
        onClick={props.onCancel}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={20} />
          <div className="space-y-1">
            <div className="text-base font-semibold">Удалить рассылку?</div>
            <p className="text-sm text-zinc-600">
              «{props.name}» будет удалена навсегда вместе со всеми
              запланированными сообщениями.
            </p>
            <p className="text-sm font-medium text-red-600">
              Действие необратимо.
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            disabled={props.isPending}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {props.isPending ? "Удаляем…" : "Удалить рассылку"}
          </button>
        </div>
      </div>
    </div>
  );
}

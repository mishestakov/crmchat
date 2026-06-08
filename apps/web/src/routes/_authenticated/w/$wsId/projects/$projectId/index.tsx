import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import {
  MessagesEditor,
  type Message,
} from "../../../../../../components/messages-editor";
import { Modal } from "../../../../../../components/modal";
import {
  Section,
  SectionItem,
  SectionItemTitle,
  SectionItemValue,
} from "../../../../../../components/section";
import { StagesEditModal } from "../../../../../../components/stages-edit-modal";
import { pluralize } from "../../../../../../lib/date-utils";
import { useEventSourceEvent } from "../../../../../../lib/hooks";
import {
  useOutreachAccounts,
  useProject,
} from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK, invalidateProject } from "../../../../../../lib/query-keys";
import { substituteVariables } from "../../../../../../lib/substitute-variables";
import { TEMPLATE_VARIABLES } from "../../../../../../lib/template-variables";
import { AddChannelsModal } from "../../../../../../components/add-channels-modal";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/projects/$projectId/",
)({
  component: SequenceDetailPage,
});

type SequenceData =
  paths["/v1/workspaces/{wsId}/projects/{projectId}"]["get"]["responses"][200]["content"]["application/json"];

type AccountRow =
  paths["/v1/workspaces/{wsId}/outreach/accounts"]["get"]["responses"][200]["content"]["application/json"][number];

function SequenceDetailPage() {
  const { wsId, projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const seq = useProject(wsId, projectId);
  const accountsQ = useOutreachAccounts(wsId);

  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/leads",
        {
          params: { path: { wsId, projectId }, query: { limit: 1, offset: 0 } },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const analyticsQ = useQuery({
    queryKey: OUTREACH_QK.projectAnalytics(wsId, projectId, 30),
    enabled: !!seq.data && seq.data.status !== "draft",
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/analytics",
        { params: { path: { wsId, projectId }, query: { period: 30 } } },
      );
      if (error) throw error;
      return data;
    },
  });

  // SSE-канал апдейтов sequence — invalidate всех зависимых query.
  // Debounce: worker может эмитить «changed» серией (несколько лидов
  // ответили подряд), не перетряхиваем кэш каждые 50ms.
  const seqStatus = seq.data?.status;
  const needsLiveUpdates = seqStatus === "active" || seqStatus === "paused";
  const invalidateTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (invalidateTimerRef.current !== null) {
      window.clearTimeout(invalidateTimerRef.current);
    }
  }, []);
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
        qc.invalidateQueries({ queryKey: OUTREACH_QK.projectLeads(wsId, projectId) });
        qc.invalidateQueries({ queryKey: OUTREACH_QK.project(wsId, projectId) });
        qc.invalidateQueries({
          // partial-key match — accordion'и в dialog'е используют разные period/grouping/viewMode
          queryKey: ["project-analytics", wsId, projectId],
        });
        invalidateTimerRef.current = null;
      }, 500);
    },
  );

  // Local editor state — только messages (правится здесь же через
  // MessagesEditor). Name редактирования из настроек нет — название
  // отображается в шапке проекта (ProjectTabs). Accounts/CRM-settings
  // правятся на отдельных sub-routes.
  const [messages, setMessages] = useState<Message[]>([]);

  // Переменные autocomplete — canonical username + канало-переменные из базы
  // (синтезируются на активации, см. prepareLeads). Статический список.
  const templateVariables = TEMPLATE_VARIABLES;
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [editingStages, setEditingStages] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showAddChannels, setShowAddChannels] = useState(false);

  useEffect(() => {
    if (!seq.data) return;
    setMessages(seq.data.messages);
  }, [seq.data]);

  const isDraft = seq.data?.status === "draft";
  const isActive = seq.data?.status === "active";
  const isPaused = seq.data?.status === "paused";
  const isDone = seq.data?.status === "done";

  const save = useMutation({
    mutationFn: async (overrides?: { messages?: Message[] }) => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId } },
          body: {
            messages: overrides?.messages ?? messages,
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId),
  });

  const activate = useMutation({
    mutationFn: async () => {
      await save.mutateAsync(undefined);
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/activate",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      invalidateProject(qc, wsId, projectId, { leads: true });
      // После запуска показываем таблицу рассылки — это то место где
      // менеджер дальше работает: видит pending/sent, отвечает.
      navigate({
        to: "/w/$wsId/projects/$projectId/leads",
        params: { wsId, projectId },
      });
    },
  });

  const pause = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/pause",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId),
  });

  const resume = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/resume",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await api.DELETE(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
      navigate({ to: "/w/$wsId/projects", params: { wsId } });
    },
  });

  const complete = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/complete",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => invalidateProject(qc, wsId, projectId, { leads: true }),
  });

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/archive",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OUTREACH_QK.projects(wsId) });
      navigate({ to: "/w/$wsId/projects", params: { wsId } });
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
  const leadsCount = leadsQ.data?.total ?? 0;
  const sortedStages = [...data.stages].sort((a, b) => a.order - b.order);
  const accountsSummary = buildAccountsSummary(data, accountsQ.data ?? []);
  const crmSummary = buildCrmSummary(data);
  const messagesSummary = buildMessagesSummary(messages);

  const confirmComplete = () => {
    if (
      confirm(
        "Завершить проект? Запланированные сообщения больше не уйдут.",
      )
    ) {
      complete.mutate();
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ProjectTabs wsId={wsId} projectId={projectId} />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
        {/* === 1. Управление — кнопки по текущему статусу ===
             Primary action слева (Запустить/Возобновить/Пауза/Архивировать),
             терминал-link справа (Удалить для draft, Завершить для active|paused).
             Status уже видно в шапке-плашке — здесь только actions. */}
        <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm">
          {isDraft && (
            <>
              <button
                type="button"
                onClick={() => activate.mutate()}
                disabled={activate.isPending || messages.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Play size={14} />
                {activate.isPending ? "Запускаем…" : "Запустить рассылку"}
              </button>
              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="ml-auto text-sm text-red-600 hover:text-red-700 hover:underline"
              >
                Удалить проект
              </button>
            </>
          )}
          {isActive && (
            <>
              <button
                type="button"
                onClick={() => pause.mutate()}
                disabled={pause.isPending}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
              >
                <Pause size={14} /> Пауза
              </button>
              <button
                type="button"
                onClick={confirmComplete}
                disabled={complete.isPending}
                className="ml-auto text-sm text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50"
              >
                {complete.isPending ? "Завершаем…" : "Завершить проект"}
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button
                type="button"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Play size={14} /> Возобновить
              </button>
              <button
                type="button"
                onClick={confirmComplete}
                disabled={complete.isPending}
                className="ml-auto text-sm text-zinc-600 hover:text-zinc-900 hover:underline disabled:opacity-50"
              >
                {complete.isPending ? "Завершаем…" : "Завершить проект"}
              </button>
            </>
          )}
          {isDone && (
            <button
              type="button"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {archive.isPending ? "Архивируем…" : "Архивировать проект"}
            </button>
          )}
        </div>

        {/* === 2. Конфигурация — что внутри проекта, видно сразу === */}
        <Section header="Конфигурация">
          <SectionItem
            withChevron
            onClick={isDone ? undefined : () => setEditingStages(true)}
            className={isDone ? "opacity-60" : ""}
          >
            <SectionItemTitle>Стадии</SectionItemTitle>
            <SectionItemValue>
              <span className="flex flex-wrap justify-end gap-1">
                {sortedStages.map((s) => (
                  <span
                    key={s.id}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700"
                  >
                    {s.name}
                  </span>
                ))}
              </span>
            </SectionItemValue>
          </SectionItem>

          <Link
            to="/w/$wsId/projects/$projectId/accounts"
            params={{ wsId, projectId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>Аккаунты</SectionItemTitle>
              <SectionItemValue>{accountsSummary}</SectionItemValue>
            </SectionItem>
          </Link>

          <Link
            to="/w/$wsId/projects/$projectId/contact-settings"
            params={{ wsId, projectId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>CRM-автоматизации</SectionItemTitle>
              <SectionItemValue>{crmSummary}</SectionItemValue>
            </SectionItem>
          </Link>
        </Section>

        {/* === 3. База лидов === */}
        <Section header="База">
          <Link
            to="/w/$wsId/projects/$projectId/leads"
            params={{ wsId, projectId }}
          >
            <SectionItem withChevron>
              <SectionItemTitle>Каналы</SectionItemTitle>
              <SectionItemValue>
                {leadsCount} {pluralize(leadsCount, "канал", "канала", "каналов")}
              </SectionItemValue>
            </SectionItem>
          </Link>

          {!isDone && (
            <button
              type="button"
              onClick={() => setShowAddChannels(true)}
              className="block w-full text-left hover:bg-zinc-50"
            >
              <SectionItem withChevron>
                <SectionItemTitle>Добавить каналы</SectionItemTitle>
                <SectionItemValue>+ ещё площадок</SectionItemValue>
              </SectionItem>
            </button>
          )}
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

        {/* === 4. Цепочка сообщений === */}
        <Section header="Цепочка сообщений">
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs text-zinc-500">{messagesSummary}</p>
            <MessagesEditor
              value={messages}
              variables={templateVariables}
              validate
              disabled={!isDraft && !isPaused}
              onChange={(next) => {
                setMessages(next);
                save.mutate({ messages: next });
              }}
              onPreview={(m) => setPreviewMsg(m)}
            />
            {!isDraft && !isPaused && messages.length > 0 && (
              <p className="mt-3 text-xs text-zinc-400">
                Редактирование сообщений доступно в статусе «Черновик» или «Пауза».
              </p>
            )}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSaveAsTemplate(true)}
                className="mt-4 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-700"
              >
                <MessageSquare size={12} /> Сохранить цепочку как шаблон
              </button>
            )}
          </div>
        </Section>

      </div>

      {previewMsg && (
        <PreviewDialog
          wsId={wsId}
          projectId={projectId}
          message={previewMsg}
          onClose={() => setPreviewMsg(null)}
        />
      )}

      {showAnalytics && analyticsQ.data && (
        <AnalyticsDialog
          wsId={wsId}
          projectId={projectId}
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

      {showSaveAsTemplate && (
        <SaveAsMessageTemplateDialog
          wsId={wsId}
          defaultName={data.name}
          messages={messages}
          onClose={() => setShowSaveAsTemplate(false)}
        />
      )}

      {editingStages && (
        <StagesEditModal
          wsId={wsId}
          projectId={projectId}
          initial={[...data.stages].sort((a, b) => a.order - b.order)}
          onClose={() => setEditingStages(false)}
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

      {(activate.error ||
        pause.error ||
        resume.error ||
        save.error ||
        remove.error ||
        complete.error ||
        archive.error) && (
        <div className="fixed bottom-4 right-4 max-w-sm rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 shadow-lg">
          {errorMessage(
            activate.error ??
              pause.error ??
              resume.error ??
              save.error ??
              remove.error ??
              complete.error ??
              archive.error,
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

function shortDelay(period: string): string {
  if (period === "minutes") return "мин";
  if (period === "hours") return "ч";
  if (period === "days") return "дн";
  return period;
}

// Сводка аккаунтов: либо «Все активные», либо до 3-х имён через запятую
// плюс «+ N ещё». Сразу показываем имена вместо «Выбрано: N» — менеджеру
// полезнее видеть с каких аккаунтов реально пишет проект.
function buildAccountsSummary(
  project: SequenceData,
  accounts: AccountRow[],
): string {
  if (project.accountsMode === "all") return "Все активные";
  const chosen = accounts
    .filter((a) => project.accountsSelected.includes(a.id))
    .map((a) => (a.tgUsername ? `@${a.tgUsername}` : (a.firstName ?? "—")));
  if (chosen.length === 0) return `Выбрано: ${project.accountsSelected.length}`;
  if (chosen.length <= 3) return chosen.join(", ");
  return `${chosen.slice(0, 3).join(", ")} + ${chosen.length - 3}`;
}

// Сводка CRM-автоматизаций: кол-во ответственных за лидов. Заменяет прежний
// прочерк «—» — без клика непонятно что внутри.
function buildCrmSummary(project: SequenceData): string {
  const owners = project.contactDefaultOwnerIds.length;
  if (owners === 0) return "Ответственный: создатель рассылки";
  if (owners === 1) return "1 ответственный";
  return `${owners} ответственных (round-robin)`;
}

// Сводка цепочки: «N шагов: первое сразу → через 1 ч → через 1 день».
// Сразу видно расписание касаний без клика «открыть редактор».
function buildMessagesSummary(messages: Message[]): string {
  if (messages.length === 0) return "Цепочка пуста";
  const delays = messages.map((m, i) =>
    i === 0
      ? "первое сразу"
      : `через ${m.delay.value} ${shortDelay(m.delay.period)}`,
  );
  return `${messages.length} ${pluralize(messages.length, "шаг", "шага", "шагов")}: ${delays.join(" → ")}`;
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

// ─────────────────────── Preview Dialog ───────────────────────

function PreviewDialog(props: {
  wsId: string;
  projectId: string;
  message: Message;
  onClose: () => void;
}) {
  const { wsId, projectId, message } = props;
  const [seed, setSeed] = useState(0);
  const sampleQ = useQuery({
    queryKey: OUTREACH_QK.sampleLead(wsId, projectId, seed),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/sample-lead",
        { params: { path: { wsId, projectId } } },
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

  const lead = sampleQ.data;
  const rendered = lead
    ? substituteVariables(message.text, {
        username: lead.username,
        properties: lead.properties,
      })
    : null;

  return (
    <Modal onClose={props.onClose} variant="sheet">
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
                  {lead.username ? `@${lead.username}` : "без identifier"}
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
    </Modal>
  );
}

// ─────────────────────── Analytics Dialog ───────────────────────

type AnalyticsData =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/analytics"]["get"]["responses"][200]["content"]["application/json"];

function AnalyticsDialog(props: {
  wsId: string;
  projectId: string;
  onClose: () => void;
}) {
  const { wsId, projectId } = props;
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [grouping, setGrouping] = useState<"day" | "week" | "month">("day");
  const [viewMode, setViewMode] = useState<"eventDate" | "sendDate">(
    "eventDate",
  );
  const dataQ = useQuery({
    queryKey: OUTREACH_QK.projectAnalytics(
      wsId,
      projectId,
      period,
      grouping,
      viewMode,
    ),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/analytics",
        {
          params: {
            path: { wsId, projectId },
            query: { period, grouping, viewMode },
          },
        },
      );
      if (error) throw error;
      return data;
    },
    placeholderData: (prev) => prev,
  });

  return (
    <Modal onClose={props.onClose} size="lg">
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
    </Modal>
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
    <Modal onClose={props.onCancel} variant="sheet">
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
    </Modal>
  );
}

// ─────────────────────── Save as message-template ───────────────────────

function SaveAsMessageTemplateDialog(props: {
  wsId: string;
  defaultName: string;
  messages: Message[];
  onClose: () => void;
}) {
  const [name, setName] = useState(props.defaultName);
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите имя шаблона");
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/message-templates",
        {
          params: { path: { wsId: props.wsId } },
          body: { name: trimmed, messages: props.messages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => props.onClose(),
  });

  return (
    <Modal onClose={props.onClose} variant="sheet">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-semibold">
          Сохранить цепочку как шаблон
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Закрыть"
          className="text-zinc-400 hover:text-zinc-700"
        >
          <X size={18} />
        </button>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Шаблон попадёт в библиотеку и будет доступен при создании новых
        проектов. Этот проект и шаблон дальше живут независимо.
      </p>
      <label className="block">
        <span className="mb-1 block text-sm text-zinc-600">Имя шаблона</span>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </label>
      {save.error && (
        <p className="mt-2 text-sm text-red-600">{errorMessage(save.error)}</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {save.isPending ? "Сохраняем…" : "Сохранить шаблон"}
        </button>
      </div>
    </Modal>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Send, Settings, X } from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import {
  StagesEditor,
  type Stage,
} from "../../../../../../components/stages-editor";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { useEventSourceEvent, useMyRole } from "../../../../../../lib/hooks";
import { Modal } from "../../../../../../components/modal";
import {
  useOutreachAccounts,
  useProject,
} from "../../../../../../lib/outreach-queries";
import { OUTREACH_QK } from "../../../../../../lib/query-keys";

export const Route = createFileRoute(
  "/_authenticated/w/$wsId/projects/$projectId/kanban",
)({
  component: KanbanPage,
});

const KANBAN_PAGE_LIMIT = 1000;

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];

const NO_STAGE = "__no_stage__"; // sentinel для колонки «Без стадии»

function KanbanPage() {
  const { wsId, projectId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAdmin = useMyRole(wsId) === "admin";
  const [editingStages, setEditingStages] = useState(false);
  // Drawer переписки — открывается по клику на бэйдж непрочитанных (#11).
  // Альтернатива openLead → переход на /contacts/$id, который дальше.
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  const accountsQ = useOutreachAccounts(wsId);

  // Клик по карточке = открыть контакт (где чат, заметки, напоминания).
  // У лида до ответа contactId = null — некуда переходить, в этом случае
  // клик игнорируется (карточка остаётся только draggable).
  const openLead = (lead: Lead) => {
    if (lead.contactId) {
      navigate({
        to: "/w/$wsId/contacts/$id",
        params: { wsId, id: lead.contactId },
      });
    }
  };

  const projectQ = useProject(wsId, projectId);
  const leadsQ = useQuery({
    queryKey: OUTREACH_QK.projectLeads(wsId, projectId, KANBAN_PAGE_LIMIT, 0),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/leads",
        {
          params: {
            path: { wsId, projectId },
            query: { limit: KANBAN_PAGE_LIMIT, offset: 0 },
          },
        },
      );
      if (error) throw error;
      return data;
    },
  });

  const move = useMutation({
    mutationFn: async (args: { itemId: string; stageId: string | null }) => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
        {
          params: {
            path: { wsId, projectId, itemId: args.itemId },
          },
          body: { stageId: args.stageId },
        },
      );
      if (error) throw error;
    },
    onMutate: async (args) => {
      // Оптимистичный update: карточка визуально перепрыгивает в новую
      // колонку до ответа сервера. Если PATCH упадёт — invalidate откатит.
      // setQueryData/getQueryData требуют exact key — передаём полный
      // (с limit/offset), как у producer'а. cancel/invalidate — prefix-match.
      const exactKey = OUTREACH_QK.projectLeads(wsId, projectId, KANBAN_PAGE_LIMIT, 0);
      await qc.cancelQueries({
        queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
      });
      const prev = qc.getQueryData<LeadsResponse>(exactKey);
      if (prev) {
        qc.setQueryData<LeadsResponse>(exactKey, {
          ...prev,
          leads: prev.leads.map((l) =>
            l.id === args.itemId ? { ...l, stageId: args.stageId } : l,
          ),
        });
      }
      return { prev };
    },
    onError: (_e, _args, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(
          OUTREACH_QK.projectLeads(wsId, projectId, KANBAN_PAGE_LIMIT, 0),
          ctx.prev,
        );
      }
    },
    onSettled: () => {
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
      });
    },
  });

  // Живой счётчик непрочитанных: contact-stream шлёт `contact` event при каждом
  // изменении unreadCount/lastMessageAt у любого контакта в воркспейсе. Один
  // контакт может быть прицеплен к нескольким лидам (в разных проектах) —
  // обновляем всех совпадающих в кэше этой страницы.
  useEventSourceEvent<{
    contactId: string;
    unreadCount: number;
    lastMessageAt: string | null;
  }>(`/v1/workspaces/${wsId}/contact-stream`, "contact", (ev) => {
    qc.setQueriesData<LeadsResponse>(
      { queryKey: OUTREACH_QK.projectLeads(wsId, projectId) },
      (prev) => {
        if (!prev) return prev;
        let changed = false;
        const nextLeads = prev.leads.map((l) => {
          if (l.contactId !== ev.contactId) return l;
          if (l.unreadCount === ev.unreadCount) return l;
          changed = true;
          return { ...l, unreadCount: ev.unreadCount };
        });
        return changed ? { ...prev, leads: nextLeads } : prev;
      },
    );
  });

  const stages = projectQ.data?.stages ?? [];
  // Канбан показывает лидов с момента срабатывания триггера проекта:
  //   - 'on-reply' (дефолт) — после ответа peer'а (project_items.repliedAt).
  //   - 'on-first-message-sent' — после первой отправки worker'a
  //     (messages[0].sentAt). До триггера лиды только в табличке /leads.
  // Контакты создаются раньше — при импорте (5A), но это не управляет
  // появлением карточки. Триггер per-проект, поэтому смотрим в projectQ.
  const trigger = projectQ.data?.contactCreationTrigger;
  const leads = useMemo(
    () =>
      (leadsQ.data?.leads ?? []).filter((l) => {
        if (trigger === "on-first-message-sent") {
          return !!l.messages[0]?.sentAt;
        }
        return !!l.repliedAt;
      }),
    [leadsQ.data?.leads, trigger],
  );

  // Группировка по stageId. Лиды со stageId который не существует в
  // текущих project.stages (юзер удалил стадию) — попадают в bucket
  // NO_STAGE, видны в отдельной колонке.
  const byStage = useMemo(() => {
    const validStageIds = new Set(stages.map((s) => s.id));
    const map = new Map<string, Lead[]>();
    for (const s of stages) map.set(s.id, []);
    map.set(NO_STAGE, []);
    for (const l of leads) {
      const key = l.stageId && validStageIds.has(l.stageId) ? l.stageId : NO_STAGE;
      map.get(key)!.push(l);
    }
    return map;
  }, [stages, leads]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.order - b.order),
    [stages],
  );

  if (projectQ.isLoading || leadsQ.isLoading) {
    return (
      <div className="p-6 text-sm text-zinc-500">Загрузка…</div>
    );
  }
  if (projectQ.error) {
    return (
      <div className="p-6 text-sm text-red-600">
        {errorMessage(projectQ.error)}
      </div>
    );
  }
  if (sortedStages.length === 0) {
    return (
      <div className="space-y-3 p-6">
        <BackButton />
        <div className="rounded-2xl bg-white p-6 text-sm shadow-sm">
          <p className="mb-2 font-medium">У проекта нет стадий канбана</p>
          <p className="text-zinc-500">
            Добавьте стадии в настройках проекта (PATCH /projects/{"{id}"}{" "}
            с полем stages — UI редактора в работе).
          </p>
        </div>
      </div>
    );
  }

  const noStageLeads = byStage.get(NO_STAGE) ?? [];

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center gap-3">
        <BackButton />
        <Link
          to="/w/$wsId/projects/$projectId"
          params={{ wsId, projectId }}
          search={{ edit: true }}
          className="ml-auto text-sm text-zinc-500 hover:text-zinc-900"
        >
          Настройки
        </Link>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setEditingStages(true)}
            className="flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
          >
            <Settings size={14} /> Стадии
          </button>
        )}
        <Link
          to="/w/$wsId/projects/$projectId/leads"
          params={{ wsId, projectId }}
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          Таблица →
        </Link>
      </div>
      {editingStages && (
        <StagesEditModal
          wsId={wsId}
          projectId={projectId}
          initial={sortedStages}
          onClose={() => setEditingStages(false)}
        />
      )}
      {leadsQ.data && leadsQ.data.leads.length === KANBAN_PAGE_LIMIT && (
        <div className="mb-3">
          <TruncationBanner
            shown={KANBAN_PAGE_LIMIT}
            total={leadsQ.data.total}
            entity="лидов"
            hint="Перейдите в табличный вид для работы с остальными."
          />
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
        {sortedStages.map((stage) => (
          <Column
            key={stage.id}
            title={stage.name}
            leads={byStage.get(stage.id) ?? []}
            onDrop={(itemId) =>
              move.mutate({ itemId, stageId: stage.id })
            }
            onOpen={openLead}
            onOpenChat={setDrawerLead}
          />
        ))}
        {noStageLeads.length > 0 && (
          <Column
            key={NO_STAGE}
            title="Без стадии"
            leads={noStageLeads}
            onDrop={(itemId) => move.mutate({ itemId, stageId: null })}
            onOpen={openLead}
            onOpenChat={setDrawerLead}
          />
        )}
      </div>
      {drawerLead && (
        <LeadChatDrawer
          wsId={wsId}
          lead={drawerLead}
          accounts={accountsQ.data ?? []}
          onClose={() => setDrawerLead(null)}
        />
      )}
    </div>
  );
}

function Column(props: {
  title: string;
  leads: Lead[];
  onDrop: (itemId: string) => void;
  onOpen: (lead: Lead) => void;
  onOpenChat: (lead: Lead) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) props.onDrop(id);
      }}
      className={
        "flex min-w-[260px] flex-1 flex-col self-stretch overflow-hidden rounded-xl p-3 transition-colors " +
        (over ? "bg-zinc-300 ring-2 ring-zinc-400" : "bg-zinc-200")
      }
    >
      <div className="mb-2 flex items-baseline gap-2 px-1 text-sm">
        <span className="font-medium">{props.title}</span>
        <span className="text-zinc-500">{props.leads.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {props.leads.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            onOpen={() => props.onOpen(l)}
            onOpenChat={() => props.onOpenChat(l)}
          />
        ))}
      </div>
    </div>
  );
}

function StagesEditModal(props: {
  wsId: string;
  projectId: string;
  initial: Stage[];
  onClose: () => void;
}) {
  const { wsId, projectId, initial, onClose } = props;
  const qc = useQueryClient();
  const [stages, setStages] = useState<Stage[]>(initial);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await api.PATCH(
        "/v1/workspaces/{wsId}/projects/{projectId}",
        {
          params: { path: { wsId, projectId } },
          body: { stages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.project(wsId, projectId),
      });
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
      });
      onClose();
    },
  });

  const dirty = JSON.stringify(stages) !== JSON.stringify(initial);

  return (
    <>
      <Modal onClose={onClose} zIndex={30}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-semibold">Стадии канбана</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mb-3 text-xs text-zinc-500">
          Меняется только этот проект. Шаблон стадий не затронется. Лиды на
          удалённых стадиях попадут в колонку «Без стадии».
        </p>
        <StagesEditor value={stages} onChange={setStages} />
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {save.isPending ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => setShowSaveAsTemplate(true)}
            disabled={stages.length === 0}
            className="ml-auto text-xs text-zinc-500 hover:text-emerald-700 disabled:opacity-50"
            title="Сохранить текущие стадии как шаблон воркспейса"
          >
            Сохранить как шаблон
          </button>
          {save.error && (
            <span className="text-xs text-red-600">
              {errorMessage(save.error)}
            </span>
          )}
        </div>
      </Modal>
      {showSaveAsTemplate && (
        <SaveAsStageTemplateDialog
          wsId={wsId}
          stages={stages}
          onClose={() => setShowSaveAsTemplate(false)}
        />
      )}
    </>
  );
}

function SaveAsStageTemplateDialog(props: {
  wsId: string;
  stages: Stage[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Введите имя шаблона");
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/stage-templates",
        {
          params: { path: { wsId: props.wsId } },
          body: { name: trimmed, stages: props.stages },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => props.onClose(),
  });

  return (
    <Modal onClose={props.onClose} variant="sheet" zIndex={40}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-semibold">
          Сохранить стадии как шаблон
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

function LeadCard(props: {
  lead: Lead;
  onOpen: () => void;
  onOpenChat: () => void;
}) {
  const { lead } = props;
  const fullName =
    typeof lead.properties.full_name === "string"
      ? lead.properties.full_name
      : null;
  const display = fullName ?? lead.username ?? lead.phone ?? "—";
  const tg = lead.username;
  const unread = lead.unreadCount;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={props.onOpen}
      className="cursor-pointer rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm hover:border-emerald-300 hover:bg-zinc-50 active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 font-medium truncate">{display}</div>
        {unread > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onOpenChat();
            }}
            className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold leading-5 text-white hover:bg-emerald-600"
            title={`${unread} непрочитанных — открыть чат`}
          >
            {unread > 99 ? "99+" : unread}
          </button>
        )}
      </div>
      {tg && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
          <Send size={11} className="text-sky-500" />@{tg}
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { User } from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { NextStepLine } from "../../../../../../components/next-step-line";
import { UnreadBadge } from "../../../../../../components/unread-badge";
import { SearchInput } from "../../../../../../components/search-input";
import {
  PLATFORMS,
  PlatformBadge,
  type Platform,
} from "../../../../../../lib/platforms";
import { useEventSourceEvent } from "../../../../../../lib/hooks";
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
  // Drawer переписки — открывается кликом по карточке (любой, не только по
  // бэйджу непрочитанных). Полная карточка контакта — ссылкой из шапки чата.
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);
  // Поиск по @username канала/админа + фильтр «ждут ответа» (непрочитанные).
  // Канбан и так только из ответивших, потому «нам написали» = вся доска;
  // полезный срез — у кого новое непрочитанное входящее.
  const [search, setSearch] = useState("");
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  // Фильтр по аккаунту, на котором висит диалог (lead.account — тот, что слал
  // опенер и принимает ответ). Для проверки качества: выбрал аккаунт → доска
  // показывает только его переписки, отсматриваешь подряд. null = все.
  const [accountFilter, setAccountFilter] = useState<string | null>(null);
  const accountsQ = useOutreachAccounts(wsId);

  // Полная карточка контакта (заметки, активность, привязка каналов) — уже не
  // в горячем пути: клик по карточке открывает чат, а сюда ведёт ссылка
  // «Открыть карточку» из шапки чата. У лида всегда есть contactId (на доске
  // только ответившие), guard — на всякий.
  const openFullCard = (lead: Lead) => {
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
    // Опционален: эмиттеры, не знающие флаг (MAX), его не шлют — не трогаем.
    markedUnread?: boolean;
  }>(`/v1/workspaces/${wsId}/contact-stream`, "contact", (ev) => {
    qc.setQueriesData<LeadsResponse>(
      { queryKey: OUTREACH_QK.projectLeads(wsId, projectId) },
      (prev) => {
        if (!prev) return prev;
        let changed = false;
        const nextLeads = prev.leads.map((l) => {
          if (l.contactId !== ev.contactId) return l;
          const markedUnread = ev.markedUnread ?? l.markedUnread;
          if (
            l.unreadCount === ev.unreadCount &&
            l.markedUnread === markedUnread
          ) {
            return l;
          }
          changed = true;
          return { ...l, unreadCount: ev.unreadCount, markedUnread };
        });
        return changed ? { ...prev, leads: nextLeads } : prev;
      },
    );
  });

  // contact-stream выше патчит unreadCount у УЖЕ загруженных лидов, но не умеет
  // ДОБАВИТЬ карточку, которая только что зашла на доску (лид ответил → бэкенд
  // ставит repliedAt + стадию). Такой лид появлялся только при случайном
  // рефетче — отсюда «в списке счётчик есть, на канбане пусто, потом прорастает».
  // project-stream «changed» шлётся ровно на эти изменения (как в табличном
  // виде) → перезапрашиваем лиды, чтобы новый ответивший появился сразу.
  useEventSourceEvent(
    `/v1/workspaces/${wsId}/projects/${projectId}/stream`,
    "changed",
    () => {
      qc.invalidateQueries({
        queryKey: OUTREACH_QK.projectLeads(wsId, projectId),
      });
    },
  );

  const stages = projectQ.data?.stages ?? [];
  // Канбан показывает лидов после ответа peer'а (project_items.repliedAt).
  // Контакт заводится на входящем (см. outreach-listener), карточка на канбане
  // появляется тогда же; до ответа лид виден только в табличке /leads.
  const leads = useMemo(() => {
    let out = (leadsQ.data?.leads ?? []).filter((l) => !!l.repliedAt);
    const q = search.trim().replace(/^@/, "").toLowerCase();
    if (q) {
      out = out.filter(
        (l) =>
          l.username?.toLowerCase().includes(q) ||
          l.channel?.username?.toLowerCase().includes(q),
      );
    }
    if (onlyWaiting) {
      out = out.filter((l) => l.unreadCount > 0 || l.markedUnread);
    }
    if (accountFilter) {
      out = out.filter((l) => l.account?.id === accountFilter);
    }
    return out;
  }, [leadsQ.data?.leads, search, onlyWaiting, accountFilter]);

  // Аккаунты, реально присутствующие на доске (по ответившим лидам) — опции
  // селектора. Берём из самих лидов (там account уже есть), а не из всего
  // воркспейса: в дропдауне только те, у кого есть карточки.
  const boardAccounts = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leadsQ.data?.leads ?? []) {
      if (!l.repliedAt || !l.account) continue;
      const a = l.account;
      if (!m.has(a.id)) {
        const label =
          [a.firstName, a.tgUsername ? `@${a.tgUsername}` : a.phoneNumber]
            .filter(Boolean)
            .join(" · ") || a.id;
        m.set(a.id, label);
      }
    }
    return [...m.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [leadsQ.data?.leads]);

  // Счётчик «ждут ответа» — по всей доске (до поиска/тоггла), стабильный сигнал.
  const waitingCount = useMemo(
    () =>
      (leadsQ.data?.leads ?? []).filter(
        (l) => !!l.repliedAt && (l.unreadCount > 0 || l.markedUnread),
      ).length,
    [leadsQ.data?.leads],
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
  const isDone = projectQ.data?.status === "done";

  return (
    <div className="flex h-full flex-col">
      <ProjectTabs wsId={wsId} projectId={projectId} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {isDone && (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            Проект завершён — карточки заморожены.
          </div>
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
        <div className="flex flex-wrap items-center gap-2">
          {boardAccounts.length > 1 && (
            <select
              value={accountFilter ?? ""}
              onChange={(e) => setAccountFilter(e.target.value || null)}
              title="Показать диалоги одного аккаунта"
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700"
            >
              <option value="">Все аккаунты</option>
              {boardAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
          <div className="w-64">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Поиск по @каналу или @админу"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyWaiting((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium " +
              (onlyWaiting
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50")
            }
          >
            Ждут ответа ({waitingCount})
          </button>
        </div>
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-3">
          {sortedStages.map((stage) => (
            <Column
              key={stage.id}
              title={stage.name}
              leads={byStage.get(stage.id) ?? []}
              onDrop={(itemId) =>
                move.mutate({ itemId, stageId: stage.id })
              }
              onOpenChat={setDrawerLead}
              isReadOnly={isDone}
            />
          ))}
          {noStageLeads.length > 0 && (
            <Column
              key={NO_STAGE}
              title="Без стадии"
              leads={noStageLeads}
              onDrop={(itemId) => move.mutate({ itemId, stageId: null })}
              onOpenChat={setDrawerLead}
              isReadOnly={isDone}
            />
          )}
        </div>
      </div>
      {drawerLead && (
        <LeadChatDrawer
          wsId={wsId}
          lead={drawerLead}
          accounts={accountsQ.data ?? []}
          onClose={() => setDrawerLead(null)}
          stageControl={{
            stages: sortedStages,
            // Стадию берём из живого кэша, а не из снапшота drawerLead — иначе
            // после смены статуса выпадашка показывала бы старое значение.
            currentStageId:
              leadsQ.data?.leads.find((l) => l.id === drawerLead.id)?.stageId ??
              null,
            onSetStage: (stageId) =>
              move.mutate({ itemId: drawerLead.id, stageId }),
            onOpenFullCard: () => openFullCard(drawerLead),
            disabled: isDone,
          }}
        />
      )}
    </div>
  );
}

function Column(props: {
  title: string;
  leads: Lead[];
  onDrop: (itemId: string) => void;
  onOpenChat: (lead: Lead) => void;
  isReadOnly?: boolean;
}) {
  const [over, setOver] = useState(false);
  const isReadOnly = !!props.isReadOnly;
  return (
    <div
      onDragOver={
        isReadOnly
          ? undefined
          : (e) => {
              e.preventDefault();
              if (!over) setOver(true);
            }
      }
      onDragLeave={isReadOnly ? undefined : () => setOver(false)}
      onDrop={
        isReadOnly
          ? undefined
          : (e) => {
              e.preventDefault();
              setOver(false);
              const id = e.dataTransfer.getData("text/plain");
              if (id) props.onDrop(id);
            }
      }
      className={
        "flex min-w-[260px] flex-1 flex-col self-stretch overflow-hidden rounded-xl p-3 transition-colors " +
        (over ? "bg-zinc-300 ring-2 ring-zinc-400" : "bg-zinc-200")
      }
    >
      <div className="mb-2 flex items-baseline gap-2 rounded-md bg-zinc-300/70 px-2.5 py-1.5 text-sm">
        <span className="font-medium">{props.title}</span>
        <span className="text-zinc-500">{props.leads.length}</span>
      </div>
      {/* min-h-0 обязателен: без него flex-ребёнок не сжимается ниже контента,
          растёт, и overflow-hidden колонки обрезает список без скролла. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {props.leads.map((l) => (
          <LeadCard
            key={l.id}
            lead={l}
            onOpenChat={() => props.onOpenChat(l)}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  );
}


function LeadCard(props: {
  lead: Lead;
  onOpenChat: () => void;
  isReadOnly?: boolean;
}) {
  const { lead } = props;
  const ch = lead.channel;
  const fullName =
    typeof lead.properties.full_name === "string"
      ? lead.properties.full_name
      : null;
  // Заголовок карточки — канал (с иконкой платформы), как в «Списке»: видно,
  // что за площадка. Админ — отдельной строкой ниже (имя + @username). Без
  // канала (DM-путь) заголовок откатывается на контакт, и строку админа тогда
  // не дублируем — он уже в заголовке.
  const channelLabel = ch
    ? ch.title || (ch.username ? `@${ch.username}` : null)
    : null;
  const adminHandle = lead.username ? `@${lead.username}` : null;
  const display =
    channelLabel ?? fullName ?? adminHandle ?? "—";
  const adminLine = channelLabel
    ? [fullName, adminHandle].filter(Boolean).join(" · ") || null
    : null;
  const platform =
    ch && ch.platform in PLATFORMS ? (ch.platform as Platform) : null;
  const unread = lead.unreadCount;

  return (
    <div
      draggable={!props.isReadOnly}
      onDragStart={
        props.isReadOnly
          ? undefined
          : (e) => {
              e.dataTransfer.setData("text/plain", lead.id);
              e.dataTransfer.effectAllowed = "move";
            }
      }
      onClick={props.onOpenChat}
      className={
        "rounded-md border border-zinc-200 bg-white p-2.5 text-sm shadow-sm hover:border-emerald-300 hover:bg-zinc-50 " +
        (props.isReadOnly
          ? "cursor-pointer"
          : "cursor-pointer active:cursor-grabbing")
      }
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          {platform && (
            <PlatformBadge platform={platform} size={13} className="shrink-0" />
          )}
          <span className="truncate">{display}</span>
        </div>
        {(unread > 0 || lead.markedUnread) && (
          <UnreadBadge count={unread} dot={lead.markedUnread} />
        )}
      </div>
      {adminLine && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
          <User size={11} className="shrink-0 text-zinc-400" />
          <span className="truncate">{adminLine}</span>
        </div>
      )}
      {lead.nextStep && (
        <div className="mt-1">
          <NextStepLine next={lead.nextStep} />
        </div>
      )}
    </div>
  );
}

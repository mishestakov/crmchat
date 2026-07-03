import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bell, Clock, User } from "lucide-react";
import type { paths } from "@repo/api-client";
import { api } from "../../../../../../lib/api";
import { getLeadHealth } from "../../../../../../lib/lead-health";
import { pluralize } from "../../../../../../lib/date-utils";
import { errorMessage } from "../../../../../../lib/errors";
import { BackButton } from "../../../../../../components/back-button";
import { ProjectTabs } from "../../../../../../components/project-tabs";
import { TruncationBanner } from "../../../../../../components/truncation-banner";
import { LeadChatDrawer } from "../../../../../../components/lead-chat-drawer";
import { AdminSuggestionBadge } from "../../../../../../components/admin-suggestion-badge";
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
import { RelationBadge } from "../../../../../../lib/channel-relation";

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

// Карточка доски = АДМИН (contactId), внутри — все его каналы-размещения в
// проекте. Переписка/пиналка/стадия у админа одни (опенер дедупится по
// админу), поэтому группа едет по воронке целиком.
type LeadGroup = { key: string; anchor: Lead; items: Lead[] };

// Якорь группы — item, на котором висит переписка (есть scheduled-история).
// Дедуп опенера по админу гарантирует, что такой ровно один; fallback —
// первый item (свежезашедший админ без отправок).
function pickAnchor(items: Lead[]): Lead {
  return items.find((l) => (l.messages?.length ?? 0) > 0) ?? items[0]!;
}

function groupLeads(leads: Lead[]): LeadGroup[] {
  const byContact = new Map<string, Lead[]>();
  const singletons: LeadGroup[] = [];
  for (const l of leads) {
    if (!l.contactId) {
      // DM-путь без контакта — каждый лид своя карточка.
      singletons.push({ key: l.id, anchor: l, items: [l] });
      continue;
    }
    const arr = byContact.get(l.contactId) ?? [];
    arr.push(l);
    byContact.set(l.contactId, arr);
  }
  const groups: LeadGroup[] = [];
  for (const [cid, items] of byContact) {
    groups.push({ key: cid, anchor: pickAnchor(items), items });
  }
  return [...groups, ...singletons];
}

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

  // Ручная пиналка (этап C): вкл/выкл серию догона на лиде из переписки. Бэкенд
  // планирует новый заход (вкл) / гасит pending (выкл) — рефетч подтянет статус,
  // от него зависит и подсветка карточки (getLeadHealth).
  const dunning = useMutation({
    mutationFn: async (args: { itemId: string; enabled: boolean }) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/dunning",
        {
          params: { path: { wsId, projectId, itemId: args.itemId } },
          body: { enabled: args.enabled },
        },
      );
      if (error) throw error;
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
            l.markedUnread === markedUnread &&
            l.lastMessageAt === ev.lastMessageAt
          ) {
            return l;
          }
          changed = true;
          // lastMessageAt тоже патчим: от него зависит подсветка застоя
          // (getLeadHealth) — иначе жёлтый/нейтраль отстаёт до рефетча, когда
          // уже-ответивший лид пишет снова (repliedAt/стадия не меняются →
          // project-stream «changed» не приходит, только этот contact-event).
          return {
            ...l,
            unreadCount: ev.unreadCount,
            markedUnread,
            lastMessageAt: ev.lastMessageAt,
          };
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
  // Группировка по админу — O(n) построение Map, зависит ТОЛЬКО от лидов.
  // Держим в отдельном memo, чтобы ввод в поиск/тоггл фильтра не пересобирал
  // группы на каждую букву (на 1000 лидов это заметный лаг).
  const allGroups = useMemo(() => {
    const replied = (leadsQ.data?.leads ?? []).filter((l) => !!l.repliedAt);
    return groupLeads(replied);
  }, [leadsQ.data?.leads]);

  const groups = useMemo(() => {
    const q = search.trim().replace(/^@/, "").toLowerCase();
    return allGroups.filter((g) => {
      if (q) {
        const hit = g.items.some(
          (l) =>
            l.username?.toLowerCase().includes(q) ||
            l.channel?.username?.toLowerCase().includes(q) ||
            l.channel?.title?.toLowerCase().includes(q),
        );
        if (!hit) return false;
      }
      // unreadCount/markedUnread — на контакте, у всех каналов одни, берём якорь.
      if (onlyWaiting && !(g.anchor.unreadCount > 0 || g.anchor.markedUnread)) {
        return false;
      }
      if (
        accountFilter &&
        !g.items.some((l) => l.account?.id === accountFilter)
      ) {
        return false;
      }
      return true;
    });
  }, [allGroups, search, onlyWaiting, accountFilter]);

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
    const map = new Map<string, LeadGroup[]>();
    for (const s of stages) map.set(s.id, []);
    map.set(NO_STAGE, []);
    for (const g of groups) {
      const sid = g.anchor.stageId;
      const key = sid && validStageIds.has(sid) ? sid : NO_STAGE;
      map.get(key)!.push(g);
    }
    return map;
  }, [stages, groups]);

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

  const noStageGroups = byStage.get(NO_STAGE) ?? [];
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
              groups={byStage.get(stage.id) ?? []}
              onDrop={(itemId) =>
                move.mutate({ itemId, stageId: stage.id })
              }
              onOpenChat={setDrawerLead}
              isReadOnly={isDone}
            />
          ))}
          {noStageGroups.length > 0 && (
            <Column
              key={NO_STAGE}
              title="Без стадии"
              groups={noStageGroups}
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
          dunningControl={{
            // active — из живого кэша (после toggle рефетч обновит подсветку и
            // кнопку), а не из снапшота drawerLead.
            active: getLeadHealth(
              leadsQ.data?.leads.find((l) => l.id === drawerLead.id) ??
                drawerLead,
            ).active,
            onToggle: (enabled) =>
              dunning.mutate({ itemId: drawerLead.id, enabled }),
            pending: dunning.isPending,
            disabled: isDone,
          }}
        />
      )}
    </div>
  );
}

function Column(props: {
  title: string;
  groups: LeadGroup[];
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
        <span className="text-zinc-500">{props.groups.length}</span>
      </div>
      {/* min-h-0 обязателен: без него flex-ребёнок не сжимается ниже контента,
          растёт, и overflow-hidden колонки обрезает список без скролла. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {props.groups.map((g) => (
          <LeadGroupCard
            key={g.key}
            group={g}
            onOpenChat={() => props.onOpenChat(g.anchor)}
            isReadOnly={isReadOnly}
          />
        ))}
      </div>
    </div>
  );
}


function LeadGroupCard(props: {
  group: LeadGroup;
  onOpenChat: () => void;
  isReadOnly?: boolean;
}) {
  const { wsId } = Route.useParams();
  const { anchor, items } = props.group;
  // Заголовок карточки — АДМИН (имя + @username): карточка = человек, разговор
  // один. Ниже — все его каналы-размещения в проекте, у каждого свой статус.
  const fullName =
    typeof anchor.properties.full_name === "string"
      ? anchor.properties.full_name
      : null;
  const adminHandle = anchor.username ? `@${anchor.username}` : null;
  const display = fullName ?? adminHandle ?? "—";
  const subline = fullName && adminHandle ? adminHandle : null;
  const unread = anchor.unreadCount;
  const health = getLeadHealth(anchor);
  // Каналы-размещения админа в этом проекте (DM-путь без канала — пропускаем).
  const channels = items
    .map((i) => i.channel)
    .filter((c): c is NonNullable<Lead["channel"]> => !!c);
  // Подсветка застоя (§1.4): красный — пиналка выкл и затих 3+ дней назад.
  // Нейтральная карточка — белая (пиналка идёт либо коммуникация свежая).
  const toneClass =
    health.color === "red"
      ? "border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100"
      : "border-zinc-200 bg-white hover:border-emerald-300 hover:bg-zinc-50";

  return (
    <div
      draggable={!props.isReadOnly}
      onDragStart={
        props.isReadOnly
          ? undefined
          : (e) => {
              // Двигаем стадию ЯКОРЯ — разговор один на админа, группа едет
              // целиком (стадия спутников для доски игнорируется).
              e.dataTransfer.setData("text/plain", anchor.id);
              e.dataTransfer.effectAllowed = "move";
            }
      }
      onClick={props.onOpenChat}
      className={
        "rounded-md border p-2.5 text-sm shadow-sm " +
        toneClass +
        " " +
        (props.isReadOnly
          ? "cursor-pointer"
          : "cursor-pointer active:cursor-grabbing")
      }
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          <User size={13} className="shrink-0 text-zinc-400" />
          <span className="truncate">{display}</span>
        </div>
        {(unread > 0 || anchor.markedUnread) && (
          <UnreadBadge count={unread} dot={anchor.markedUnread} />
        )}
      </div>
      {subline && (
        <div className="mt-0.5 truncate pl-[19px] text-xs text-zinc-500">
          {subline}
        </div>
      )}
      {channels.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {channels.map((c) => {
            const platform =
              c.platform in PLATFORMS ? (c.platform as Platform) : null;
            return (
              <div key={c.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  {platform && (
                    <PlatformBadge
                      platform={platform}
                      size={12}
                      className="shrink-0"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-700">
                    {c.title || (c.username ? `@${c.username}` : "—")}
                  </span>
                  <RelationBadge status={c.relationStatus} />
                </div>
                {c.suggestedAdmin && (
                  <AdminSuggestionBadge
                    wsId={wsId}
                    channelId={c.id}
                    suggestedAdmin={c.suggestedAdmin}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      {anchor.nextStep && (
        <div className="mt-1">
          <NextStepLine next={anchor.nextStep} />
        </div>
      )}
      {health.badge?.kind === "dunning" && (
        <div className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
          <Bell size={11} className="shrink-0 text-zinc-400" />
          <span>
            пиналка {health.badge.sent}/{health.badge.total}
          </span>
        </div>
      )}
      {health.badge?.kind === "stale" && (
        <div
          className={
            "mt-1 flex items-center gap-1 text-xs " +
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
    </div>
  );
}

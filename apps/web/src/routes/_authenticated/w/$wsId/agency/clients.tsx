import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
  Pin,
  PinOff,
  Plus,
  Receipt,
  Search,
  Send,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/w/$wsId/agency/clients")({
  validateSearch: (s: Record<string, unknown>) => ({
    clientId: typeof s.clientId === "string" ? s.clientId : undefined,
    projectId: typeof s.projectId === "string" ? s.projectId : undefined,
    tab: typeof s.tab === "string" ? s.tab : "kanban",
  }),
  component: ClientsExplorer,
});

// === MOCK DATA — это ВРЕМЕННАЯ верстка для согласования UX, заменится в P1 ===

type ProjectStatus = "active" | "draft" | "done";
type Project = {
  id: string;
  name: string;
  status: ProjectStatus;
  budget: number;
  spent: number;
  placements: number;
};
type Client = {
  id: string;
  name: string;
  projects: Project[];
};

const MOCK_CLIENTS: Client[] = [
  {
    id: "c1",
    name: "Coca-Cola",
    projects: [
      { id: "p1", name: "Q4 2026 Holiday", status: "active", budget: 2_000_000, spent: 850_000, placements: 18 },
      { id: "p2", name: "Cold pre-launch", status: "draft", budget: 500_000, spent: 0, placements: 0 },
    ],
  },
  {
    id: "c2",
    name: "Beeline",
    projects: [
      { id: "p3", name: "Тариф «Молодёжный»", status: "active", budget: 1_500_000, spent: 1_200_000, placements: 24 },
      { id: "p4", name: "B2B SMB сегмент", status: "active", budget: 800_000, spent: 320_000, placements: 9 },
      { id: "p5", name: "Лето 2026", status: "done", budget: 600_000, spent: 600_000, placements: 12 },
    ],
  },
  {
    id: "c3",
    name: "Skyeng",
    projects: [
      { id: "p6", name: "EdTech Q1", status: "draft", budget: 1_200_000, spent: 0, placements: 0 },
    ],
  },
];

const PINNED_IDS = new Set(["p1", "p3"]);

const KANBAN_STAGES = [
  { id: "selection", label: "Подбор", count: 12 },
  { id: "offer", label: "Оффер", count: 5 },
  { id: "price", label: "Прайс получен", count: 3 },
  { id: "draft", label: "Драфт", count: 4 },
  { id: "approval", label: "Согласование", count: 2 },
  { id: "scheduled", label: "Запланировано", count: 6 },
  { id: "published", label: "Опубликовано", count: 8 },
  { id: "closed", label: "Закрыто", count: 14 },
] as const;

const MOCK_PLACEMENTS: Record<string, { channel: string; subs: string; price: string }[]> = {
  selection: [
    { channel: "@cryptotrend", subs: "120K", price: "—" },
    { channel: "@finance_daily", subs: "84K", price: "—" },
    { channel: "@startup_news", subs: "210K", price: "—" },
  ],
  offer: [
    { channel: "@web3_today", subs: "45K", price: "ждём ответа" },
    { channel: "@solana_ru", subs: "67K", price: "ждём ответа" },
  ],
  price: [
    { channel: "@bigchaintalk", subs: "180K", price: "85k ₽" },
    { channel: "@btcpulse", subs: "92K", price: "42k ₽" },
  ],
  draft: [
    { channel: "@kuznetsov_blog", subs: "34K", price: "28k ₽" },
  ],
  approval: [
    { channel: "@tech_review", subs: "150K", price: "70k ₽" },
  ],
  scheduled: [
    { channel: "@news_sphere", subs: "220K", price: "95k ₽" },
    { channel: "@digital_today", subs: "78K", price: "35k ₽" },
  ],
  published: [
    { channel: "@morning_brief", subs: "310K", price: "120k ₽" },
    { channel: "@coinmaster", subs: "95K", price: "48k ₽" },
  ],
  closed: [
    { channel: "@ru_invest", subs: "67K", price: "30k ₽" },
  ],
};

const STATUS_COLOR: Record<ProjectStatus, string> = {
  active: "bg-emerald-500",
  draft: "bg-zinc-300",
  done: "bg-zinc-400",
};

const STATUS_LABEL: Record<ProjectStatus, string> = {
  active: "Идёт",
  draft: "Черновик",
  done: "Завершён",
};

function ClientsExplorer() {
  const { wsId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const [expandedClients, setExpandedClients] = useState<Set<string>>(
    () => new Set(MOCK_CLIENTS.map((c) => c.id)),
  );
  const [query, setQuery] = useState("");

  const allProjects = MOCK_CLIENTS.flatMap((c) =>
    c.projects.map((p) => ({ ...p, clientName: c.name, clientId: c.id })),
  );
  const pinnedProjects = allProjects.filter((p) => PINNED_IDS.has(p.id));

  const selected =
    allProjects.find((p) => p.id === search.projectId)
    ?? pinnedProjects[0]
    ?? allProjects[0];

  const setSelected = (clientId: string, projectId: string) => {
    navigate({
      to: "/w/$wsId/agency/clients",
      params: { wsId },
      search: { clientId, projectId, tab: search.tab },
      replace: true,
    });
  };

  const setTab = (tab: string) => {
    navigate({
      to: "/w/$wsId/agency/clients",
      params: { wsId },
      search: { ...search, tab },
      replace: true,
    });
  };

  const toggleClient = (id: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = MOCK_CLIENTS.map((c) => ({
    ...c,
    projects: c.projects.filter(
      (p) =>
        !query
        || c.name.toLowerCase().includes(query.toLowerCase())
        || p.name.toLowerCase().includes(query.toLowerCase()),
    ),
  })).filter((c) => !query || c.projects.length > 0);

  return (
    <div className="flex h-screen">
      {/* Левая панель: explorer клиентов */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 p-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск..."
              className="w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {pinnedProjects.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 flex items-center gap-1.5 px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                <Pin size={10} /> Закреплено
              </div>
              {pinnedProjects.map((p) => (
                <ProjectRow
                  key={p.id}
                  name={p.name}
                  subline={p.clientName}
                  status={p.status}
                  selected={selected?.id === p.id}
                  onClick={() => setSelected(p.clientId, p.id)}
                />
              ))}
            </div>
          )}

          <div className="mb-1 flex items-center justify-between px-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            <span>Клиенты</span>
            <button
              type="button"
              className="flex items-center gap-0.5 normal-case tracking-normal text-emerald-700 hover:text-emerald-800"
            >
              <Plus size={11} />
              новый
            </button>
          </div>

          {filtered.map((client) => {
            const isExpanded = expandedClients.has(client.id);
            return (
              <div key={client.id} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => toggleClient(client.id)}
                  className="flex w-full items-center gap-1 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                >
                  {isExpanded ? (
                    <ChevronDown size={14} className="text-zinc-400" />
                  ) : (
                    <ChevronRight size={14} className="text-zinc-400" />
                  )}
                  <Briefcase size={13} className="text-zinc-400" />
                  <span className="truncate font-medium">{client.name}</span>
                  <span className="ml-auto text-xs text-zinc-400">
                    {client.projects.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="ml-4 mt-0.5 border-l border-zinc-100 pl-2">
                    {client.projects.map((p) => (
                      <ProjectRow
                        key={p.id}
                        name={p.name}
                        status={p.status}
                        selected={selected?.id === p.id}
                        onClick={() => setSelected(client.id, p.id)}
                      />
                    ))}
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 hover:text-emerald-700"
                    >
                      <Plus size={12} /> Новый проект
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Правая панель: проект */}
      <main className="flex min-w-0 flex-1 flex-col bg-zinc-50">
        {selected ? (
          <ProjectView
            project={selected}
            tab={search.tab ?? "kanban"}
            onTab={setTab}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Выберите проект слева
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectRow({
  name,
  subline,
  status,
  selected,
  onClick,
}: {
  name: string;
  subline?: string;
  status: ProjectStatus;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-zinc-50 " +
        (selected ? "bg-emerald-50 text-emerald-900" : "text-zinc-700")
      }
    >
      <span className={"h-1.5 w-1.5 shrink-0 rounded-full " + STATUS_COLOR[status]} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{name}</div>
        {subline && <div className="truncate text-[11px] text-zinc-400">{subline}</div>}
      </div>
    </button>
  );
}

function ProjectView({
  project,
  tab,
  onTab,
}: {
  project: { id: string; name: string; status: ProjectStatus; budget: number; spent: number; placements: number };
  tab: string;
  onTab: (t: string) => void;
}) {
  const isPinned = PINNED_IDS.has(project.id);

  return (
    <>
      {/* Header */}
      <div className="border-b border-zinc-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <span
            className={
              "rounded-full px-2 py-0.5 text-xs " +
              (project.status === "active"
                ? "bg-emerald-100 text-emerald-800"
                : project.status === "draft"
                  ? "bg-zinc-100 text-zinc-600"
                  : "bg-zinc-200 text-zinc-700")
            }
          >
            {STATUS_LABEL[project.status]}
          </span>
          <button
            type="button"
            className="ml-auto flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900"
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            {isPinned ? "Открепить" : "Закрепить"}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
          <span>Бюджет: {fmt(project.budget)} ₽</span>
          <span>Потрачено: {fmt(project.spent)} ₽</span>
          <span>Размещений: {project.placements}</span>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-0.5 border-b border-transparent -mb-3">
          <Tab id="kanban" current={tab} onTab={onTab} icon={<LayoutGrid size={13} />}>
            Канбан
          </Tab>
          <Tab id="brief" current={tab} onTab={onTab} icon={<FileText size={13} />}>
            Бриф
          </Tab>
          <Tab id="finance" current={tab} onTab={onTab} icon={<Receipt size={13} />}>
            Финансы
          </Tab>
          <Tab id="artifacts" current={tab} onTab={onTab} icon={<FileText size={13} />}>
            Артефакты
          </Tab>
          <Tab id="report" current={tab} onTab={onTab} icon={<Send size={13} />}>
            Отчёт
          </Tab>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === "kanban" && <KanbanMock />}
        {tab !== "kanban" && (
          <div className="p-12 text-center text-sm text-zinc-500">
            Вкладка <code className="bg-zinc-100 px-1.5 py-0.5 rounded">{tab}</code> —
            появится позже (см. <code>specs/agency-pivot.md</code>)
          </div>
        )}
      </div>
    </>
  );
}

function Tab({
  id,
  current,
  onTab,
  icon,
  children,
}: {
  id: string;
  current: string;
  onTab: (t: string) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const active = id === current;
  return (
    <button
      type="button"
      onClick={() => onTab(id)}
      className={
        "flex items-center gap-1.5 rounded-t px-3 py-1.5 text-sm transition-colors " +
        (active
          ? "border-b-2 border-emerald-600 text-emerald-700 font-medium"
          : "text-zinc-500 hover:text-zinc-900")
      }
    >
      {icon}
      {children}
    </button>
  );
}

function KanbanMock() {
  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {KANBAN_STAGES.map((stage) => (
        <div key={stage.id} className="flex w-64 shrink-0 flex-col">
          <div className="mb-2 flex items-center justify-between px-2 text-xs font-medium text-zinc-600">
            <span>{stage.label}</span>
            <span className="text-zinc-400">{stage.count}</span>
          </div>
          <div className="flex flex-col gap-2">
            {(MOCK_PLACEMENTS[stage.id] ?? []).map((p, i) => (
              <div
                key={i}
                className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-sm hover:border-emerald-300"
              >
                <div className="font-medium">{p.channel}</div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                  <span>{p.subs} подписчиков</span>
                  <span>{p.price}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

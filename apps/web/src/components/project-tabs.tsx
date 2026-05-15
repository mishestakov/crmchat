import { Link, useMatchRoute } from "@tanstack/react-router";
import { useProject } from "../lib/outreach-queries";
import { rememberLastProjectView } from "../lib/last-project-view";
import { BackButton } from "./back-button";

// Шапка проекта — три равноправных представления:
//   • Канбан — основной рабочий экран (карточки по стадиям, drawer-чаты).
//   • Список — диагностика рассылки (pending/sent, ошибки, фильтры).
//   • Настройки — конфигурация, стадии, статус, удаление/архивация.
// Primary-кнопка «Импортировать CSV» рендерится caller'ом справа, чтобы
// каждая страница сама решала когда показывать (например, скрывать в done).
export function ProjectTabs(props: {
  wsId: string;
  projectId: string;
  rightSlot?: React.ReactNode;
}) {
  const { wsId, projectId, rightSlot } = props;
  const seq = useProject(wsId, projectId);
  const matchRoute = useMatchRoute();
  const isLeads = !!matchRoute({
    to: "/w/$wsId/projects/$projectId/leads",
    params: { wsId, projectId },
  });
  const isKanban = !!matchRoute({
    to: "/w/$wsId/projects/$projectId/kanban",
    params: { wsId, projectId },
  });
  const isSettings = !!matchRoute({
    to: "/w/$wsId/projects/$projectId",
    params: { wsId, projectId },
  });

  return (
    <div className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 pt-3">
        <div className="flex items-center gap-3">
          <BackButton />
          <h1 className="truncate text-lg font-semibold">
            {seq.data?.name ?? "…"}
          </h1>
          {seq.data && (
            <StatusBadge status={seq.data.status} />
          )}
          {rightSlot && <div className="ml-auto">{rightSlot}</div>}
        </div>
        {/* В draft канбан и список пусты — пока проект не запустили,
            смотреть там нечего. Показываем только «Настройки», чтобы
            юзер не путался. */}
        {seq.data?.status === "draft" ? (
          <div className="h-2" />
        ) : (
          <nav className="-mb-px flex items-center gap-1 text-sm">
            <Tab
              to="/w/$wsId/projects/$projectId/kanban"
              wsId={wsId}
              projectId={projectId}
              active={isKanban}
              label="Канбан"
              onClick={() => rememberLastProjectView(projectId, "kanban")}
            />
            <Tab
              to="/w/$wsId/projects/$projectId/leads"
              wsId={wsId}
              projectId={projectId}
              active={isLeads}
              label="Список"
              onClick={() => rememberLastProjectView(projectId, "leads")}
            />
            <Tab
              to="/w/$wsId/projects/$projectId"
              wsId={wsId}
              projectId={projectId}
              active={isSettings}
              label="Настройки"
            />
          </nav>
        )}
      </div>
    </div>
  );
}

function Tab(props: {
  to:
    | "/w/$wsId/projects/$projectId/kanban"
    | "/w/$wsId/projects/$projectId/leads"
    | "/w/$wsId/projects/$projectId";
  wsId: string;
  projectId: string;
  active: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Link
      to={props.to}
      params={{ wsId: props.wsId, projectId: props.projectId }}
      onClick={props.onClick}
      className={
        "border-b-2 px-4 py-2 font-medium transition-colors " +
        (props.active
          ? "border-emerald-600 text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-900")
      }
    >
      {props.label}
    </Link>
  );
}

function StatusBadge(props: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-zinc-100 text-zinc-600",
    active: "bg-emerald-100 text-emerald-700",
    paused: "bg-amber-100 text-amber-700",
    done: "bg-zinc-100 text-zinc-600",
    archived: "bg-zinc-100 text-zinc-500",
  };
  const labels: Record<string, string> = {
    draft: "Черновик",
    active: "Идёт",
    paused: "Пауза",
    done: "Завершена",
    archived: "В архиве",
  };
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-xs " +
        (styles[props.status] ?? "bg-zinc-100 text-zinc-600")
      }
    >
      {labels[props.status] ?? props.status}
    </span>
  );
}

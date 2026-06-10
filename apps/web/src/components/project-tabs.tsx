import { Link, useMatchRoute, useNavigate } from "@tanstack/react-router";
import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Play } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useProject } from "../lib/outreach-queries";
import { OUTREACH_QK, invalidateProject } from "../lib/query-keys";
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
        {/* «Список» — рабочий список каналов проекта (добавление каналов
            живёт там), нужен и в черновике. «Канбан» в черновике пуст
            (стадий ещё нет) — показываем его только после запуска. */}
        <nav className="-mb-px flex items-center gap-1 text-sm">
          {seq.data && seq.data.status !== "draft" && (
            <Tab
              to="/w/$wsId/projects/$projectId/kanban"
              wsId={wsId}
              projectId={projectId}
              active={isKanban}
              label="Канбан"
              onClick={() => rememberLastProjectView(projectId, "kanban")}
            />
          )}
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
        {seq.data?.status === "draft" && (
          <LaunchPanel
            wsId={wsId}
            projectId={projectId}
            messagesCount={seq.data.messages.length}
          />
        )}
      </div>
    </div>
  );
}

// Чек-лист запуска (draft, на всех табах): те же четыре условия, что гейт
// /activate на бэке, каждое — ссылка к месту починки. До этого кнопка жила
// только в «Настройках» и дизейблилась без объяснений — на тесте 10.06.26
// её не нашли, а причину неактивности не поняли.
function LaunchPanel(props: {
  wsId: string;
  projectId: string;
  messagesCount: number;
}) {
  const { wsId, projectId, messagesCount } = props;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const readinessQ = useQuery({
    queryKey: OUTREACH_QK.projectReadiness(wsId, projectId),
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/readiness",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const activate = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/activate",
        { params: { path: { wsId, projectId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      invalidateProject(qc, wsId, projectId, { leads: true });
      // После запуска — в таблицу рассылки: там менеджер дальше работает.
      navigate({
        to: "/w/$wsId/projects/$projectId/leads",
        params: { wsId, projectId },
      });
    },
  });

  // PATCH сообщений в полёте (автосейв из «Настроек», ключ в index.tsx) —
  // активация подождёт, иначе /activate снапшотит старую цепочку.
  const savingMessages =
    useIsMutating({ mutationKey: ["project-save", projectId] }) > 0;

  const r = readinessQ.data;
  if (!r) return null;

  const listOk = r.leadsTotal > 0;
  const contactsOk = listOk && r.leadsNoContact === 0;
  const accountsOk = r.accountsCount > 0;
  const chainOk = messagesCount > 0;
  const allOk = listOk && contactsOk && accountsOk && chainOk;

  const itemCls = (ok: boolean) =>
    "inline-flex items-center gap-1 hover:underline " +
    (ok ? "text-zinc-500" : "font-medium text-amber-700");
  const icon = (ok: boolean) =>
    ok ? (
      <CircleCheck size={13} className="text-emerald-600" />
    ) : (
      <CircleAlert size={13} className="text-amber-600" />
    );

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 py-2 text-xs">
      <Link
        to="/w/$wsId/projects/$projectId/leads"
        params={{ wsId, projectId }}
        className={itemCls(listOk)}
      >
        {icon(listOk)}
        {listOk ? `Каналы: ${r.leadsTotal}` : "Список пуст — добавьте каналы"}
      </Link>
      <Link
        to="/w/$wsId/projects/$projectId/leads"
        params={{ wsId, projectId }}
        search={{ filter: contactsOk ? undefined : "no-contact" }}
        className={itemCls(contactsOk)}
      >
        {icon(contactsOk)}
        {r.leadsNoContact > 0
          ? `Без контакта: ${r.leadsNoContact} — показать`
          : listOk
            ? "Контакты у всех"
            : "Контакты появятся со списком"}
      </Link>
      <Link
        to="/w/$wsId/projects/$projectId/accounts"
        params={{ wsId, projectId }}
        className={itemCls(accountsOk)}
      >
        {icon(accountsOk)}
        {accountsOk
          ? `Аккаунты: ${r.accountsCount}`
          : "Нет активных аккаунтов"}
      </Link>
      <Link
        to="/w/$wsId/projects/$projectId"
        params={{ wsId, projectId }}
        className={itemCls(chainOk)}
      >
        {icon(chainOk)}
        {chainOk
          ? `Цепочка: ${messagesCount} сообщ.`
          : "Цепочка пуста — напишите сообщение"}
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {activate.error && (
          <span className="text-red-600">{errorMessage(activate.error)}</span>
        )}
        <button
          type="button"
          onClick={() => activate.mutate()}
          disabled={!allOk || activate.isPending || savingMessages}
          title={allOk ? undefined : "Закройте пункты чек-листа слева"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Play size={12} />
          {activate.isPending
            ? "Запускаем…"
            : savingMessages
              ? "Сохраняем…"
              : "Запустить рассылку"}
        </button>
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

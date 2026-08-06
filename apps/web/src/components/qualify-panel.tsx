import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, RotateCw } from "lucide-react";
import { CRM_DISQUALIFY_REASONS } from "@repo/core";
import type { paths } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { OUTREACH_QK, invalidateProject } from "../lib/query-keys";
import { RknBadge } from "./channel-badges";
import { formatMembers } from "./channel-card";
import { ChannelDrawer } from "./channel-drawer";
import { externalHref } from "../lib/external-href";
import { pluralize } from "../lib/date-utils";
import { PlatformBadge, type Platform } from "../lib/platforms";

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];

// «Требует внимания» = очередь этого экрана: неотсмотренные ЛИБО строки, чей
// вердикт не доехал до CRM. Один предикат на оба списка («Все» со страницы и
// «Мои» с серверного фильтра) — они вычитаются друг из друга, и дрейф правила
// давал бы дубли/пропажи строк.
const needsAttention = (l: Lead): boolean =>
  l.qualification === "pending" || !!l.crmSyncError;

// Экран квалификации. Строка = КАНАЛ, а не админ: вердикт выносится по каналу
// (накрутки, тематика, живость — свойства площадки), и в CRM тикет тоже заводится
// на канал. Поэтому таблица тут своя, а не общая админ-группированная.
//
// Пока вердикта нет, опенер каналу не уйдёт — это гейт рассылки, а не пометка.

export function QualifyPanel(props: {
  wsId: string;
  projectId: string;
  leads: Lead[];
  /** id текущего юзера — для фильтра «Мои» и плашек «за X». */
  meId: string | null;
  /** CRM-синк привязан к одному проекту (env на сервере) — кнопку пулла
   *  показываем только в нём, ручка другим отвечает 403. */
  crmSyncEnabled: boolean;
  readOnly?: boolean;
}) {
  const qc = useQueryClient();
  // Разбор идёт от «своей полки»: менеджер отщипывает пачку кнопкой «Взять»,
  // видит своих, выносит вердикты. «Все» — обзорный режим (что свободно, кто
  // чем занят), из него можно забрать конкретного.
  const [view, setView] = useState<"mine" | "all">("mine");
  const [batch, setBatch] = useState(15);

  const claimNext = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/claim-next",
        {
          params: { path: { wsId: props.wsId, projectId: props.projectId } },
          body: { count: batch },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      setView("mine");
      invalidateProject(qc, props.wsId, props.projectId, { leads: true });
    },
  });

  // Пулл дельты из корп-CRM: новые тикеты приземляются неразобранными лидами,
  // у известных обновляется зеркало статуса/владельца.
  const crmPull = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/crm-pull",
        { params: { path: { wsId: props.wsId, projectId: props.projectId } } },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      invalidateProject(qc, props.wsId, props.projectId, { leads: true }),
  });

  // Панель — очередь «требуют внимания», а не только неотсмотренные. Лид, чей
  // вердикт не доехал до CRM, вердикт уже имеет и в pending не попадает — а
  // именно он и нуждается в действии: тикета в CRM нет, отчётность врёт.
  // Раньше кнопка «повторить» рендерилась только внутри pending-строк, то есть
  // была недостижима вообще.
  const queue = props.leads.filter(needsAttention);

  // «Мои» — отдельным запросом с серверным фильтром, а не выцеживанием из
  // props.leads: страница лидов — окно первых 1000 строк, и на большом
  // проекте закреплённое за менеджером лежит за его пределами (нажал «взять
  // 15» — а в «Моих» пусто). Ключ — под префиксом project-leads, чтобы
  // invalidateProject перезапрашивал и его.
  const mineQ = useQuery({
    queryKey: [
      ...OUTREACH_QK.projectLeads(props.wsId, props.projectId),
      "assigned-me",
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/leads",
        {
          params: {
            path: { wsId: props.wsId, projectId: props.projectId },
            query: { limit: 1000, offset: 0, assigned: "me" },
          },
        },
      );
      if (error) throw error;
      return data!;
    },
  });
  // Свои в разборе + ЛЮБЫЕ строки с недоехавшим CRM-тикетом (со страницы):
  // вердикт у них уже есть, «взять» их нельзя, и спрятанные за фильтром «Мои»
  // они потерялись бы навсегда (автор в отпуске — чинить некому). Ошибки
  // редки, поэтому показываем их всем поверх своих.
  const mineRows = (mineQ.data?.leads ?? []).filter(needsAttention);
  const mineIds = new Set(mineRows.map((l) => l.id));
  const strayErrors = queue.filter(
    (l) => l.crmSyncError && !mineIds.has(l.id),
  );
  const mine = [...mineRows, ...strayErrors];
  const shown = view === "mine" ? mine : queue;

  // Подсветка «этим админом уже занимается X»: канал свободен, но другой канал
  // ТОГО ЖЕ контакта закреплён за КОЛЛЕГОЙ — не пишем одному человеку вдвоём.
  // Свои закрепления в карту не кладём (иначе на паре «мой + Юлин» мой мог бы
  // затереть Юлин и погасить предупреждение). Видимость карты — страница +
  // мои: совпадение за пределами окна не увидим, принято как ограничение.
  const claimsByContact = new Map<string, { id: string; name: string }>();
  for (const l of [...props.leads, ...mineRows]) {
    if (
      l.contactId &&
      l.assignedTo &&
      l.assignedTo.id !== props.meId &&
      !claimsByContact.has(l.contactId)
    ) {
      claimsByContact.set(l.contactId, l.assignedTo);
    }
  }

  // Гейта «укажите CRM-логин» больше нет: тикеты мы не создаём (владельца при
  // создании не проставляем), а переходы по существующим владельца не требуют.
  // Логин остался нужен только для маппинга «владелец тикета → менеджер» при
  // пулле — это забота пулла, вердикты им не блокируем.

  // Ранний return'а «всё отсмотрено» здесь нет сознательно: очередь на экране
  // — окно первой страницы, и её пустота НЕ значит, что свободных нет на
  // сервере. Тулбар с «Взять в разбор» доступен всегда.
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm">
        <div className="flex overflow-hidden rounded-lg border border-zinc-200 text-sm">
          <button
            type="button"
            onClick={() => {
              setView("mine");
              claimNext.reset();
            }}
            className={
              "px-3 py-1 " +
              (view === "mine" ? "bg-zinc-800 text-white" : "text-zinc-600")
            }
          >
            Мои ({mine.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setView("all");
              // Сброс «+N каналов» / «свободных больше нет»: баннер — ответ на
              // конкретный клик, а не вечное состояние мира.
              claimNext.reset();
            }}
            className={
              "px-3 py-1 " +
              (view === "all" ? "bg-zinc-800 text-white" : "text-zinc-600")
            }
          >
            Все ({queue.length})
          </button>
        </div>
        {props.crmSyncEnabled && (
          <>
            <button
              type="button"
              disabled={crmPull.isPending || props.readOnly}
              onClick={() => crmPull.mutate()}
              className="rounded-lg border border-zinc-200 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {crmPull.isPending ? "Тянем…" : "Подтянуть из CRM"}
            </button>
            {crmPull.data && (
              <span className="text-xs text-zinc-500">
                +{crmPull.data.created} новых, {crmPull.data.updated} обновлено
                {crmPull.data.skippedNoLink > 0 &&
                  `, ${crmPull.data.skippedNoLink} без ссылки`}
                {crmPull.data.failed > 0 && (
                  <span className="text-red-600">
                    {" "}
                    ({crmPull.data.failed} с ошибкой)
                  </span>
                )}
                {crmPull.data.truncated && (
                  <span className="text-amber-700">
                    {" "}
                    — CRM отдала первую тысячу, нажмите ещё раз, чтобы дочитать
                  </span>
                )}
              </span>
            )}
            {crmPull.error && (
              <span className="text-xs text-red-600">
                {errorMessage(crmPull.error)}
              </span>
            )}
          </>
        )}
        {/* Счётчик «свободных» тут не рисуем сознательно: страница лидов
            ограничена лимитом, и на большом проекте цифра со страницы врала
            бы. Правду о доступности говорит сам сервер результатом забора. */}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={batch}
            disabled={claimNext.isPending}
            onChange={(e) => setBatch(Number(e.target.value))}
            className="rounded-lg border border-zinc-200 px-2 py-1 text-sm text-zinc-700"
          >
            {[5, 15, 30].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={claimNext.isPending || props.readOnly}
            onClick={() => claimNext.mutate()}
            className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Взять в разбор
          </button>
          {claimNext.data &&
            (claimNext.data.claimed > 0 ? (
              <span className="text-xs text-zinc-500">
                +{claimNext.data.claimed}{" "}
                {pluralize(claimNext.data.claimed, "канал", "канала", "каналов")}
              </span>
            ) : (
              <span className="text-xs text-amber-700">
                свободных больше нет
              </span>
            ))}
          {claimNext.error && (
            <span className="text-xs text-red-600">
              {errorMessage(claimNext.error)}
            </span>
          )}
        </div>
      </div>
      {/* Подсказку «возьмите пачку» гасим сразу после успешного забора: пока
          рефетч не доехал, «Мои» ещё пустые, и активная кнопка рядом с таким
          текстом провоцирует второй, ненужный забор. */}
      {view === "mine" &&
        mine.length === 0 &&
        !mineQ.isLoading &&
        !claimNext.data?.claimed && (
          <div className="rounded-xl bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
            У вас нет лидов в разборе — нажмите «Взять в разбор», чтобы
            отщипнуть пачку из общей очереди.
          </div>
        )}
      {view === "all" && queue.length === 0 && (
        <div className="rounded-xl bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
          На этой странице всё отсмотрено. Свободные могут оставаться дальше по
          списку — «Взять в разбор» работает по всему проекту.
        </div>
      )}
      {shown.map((lead) => (
        <QualifyRow
          key={lead.id}
          wsId={props.wsId}
          projectId={props.projectId}
          lead={lead}
          meId={props.meId}
          adminHolder={
            lead.contactId ? claimsByContact.get(lead.contactId) : undefined
          }
          readOnly={props.readOnly}
        />
      ))}
    </div>
  );
}

function QualifyRow(props: {
  wsId: string;
  projectId: string;
  lead: Lead;
  meId: string | null;
  /** Кто держит ДРУГОЙ канал этого же контакта (подсветка «админ у X»). */
  adminHolder?: { id: string; name: string };
  readOnly?: boolean;
}) {
  const { lead } = props;
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [channelOpen, setChannelOpen] = useState(false);

  const mineClaim = lead.assignedTo?.id === props.meId;
  const otherClaim = !!lead.assignedTo && !mineClaim;

  // claim и unclaim — один шейп вызова, разные ручки (обе поканальные).
  // Пути — литералами, не шаблонной строкой: так переименование ручки ломает
  // typecheck, а не молча даёт 404 в проде.
  const claimMut = useMutation({
    mutationFn: async (action: "claim" | "unclaim") => {
      const { data, error } = await api.POST(
        action === "claim"
          ? "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/claim"
          : "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unclaim",
        {
          params: {
            path: {
              wsId: props.wsId,
              projectId: props.projectId,
              itemId: lead.id,
            },
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () =>
      invalidateProject(qc, props.wsId, props.projectId, { leads: true }),
  });

  const qualify = useMutation({
    mutationFn: async (body: {
      verdict: "qualified" | "disqualified";
      reason?: string;
    }) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/qualify",
        {
          params: {
            path: {
              wsId: props.wsId,
              projectId: props.projectId,
              itemId: lead.id,
            },
          },
          body: { verdict: body.verdict, reason: body.reason ?? null },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      // Вердикт вынесен — держать канал открытым незачем. Закрываем явно, а не
      // полагаемся на то, что строка уйдёт из очереди и утащит дровер с собой:
      // при недоставке в CRM строка остаётся, и дровер завис бы открытым.
      setChannelOpen(false);
      invalidateProject(qc, props.wsId, props.projectId, { leads: true });
    },
    // Сброс выбора обязателен: иначе после сбоя причина остаётся выбранной, а
    // повторный выбор ТОГО ЖЕ пункта не даёт события change — менеджер не
    // сможет отправить вердикт заново, и это выглядит поломкой кнопки.
    onError: () => setReason(""),
  });

  const busy = qualify.isPending || props.readOnly;

  // Один и тот же вердикт рендерится и в строке, и в дровере: часть каналов
  // отбраковывается сходу по названию, часть требует посмотреть ленту. Мутация
  // при этом одна на обе копии — busy и текст ошибки общие.
  const verdictControls = lead.qualification === "pending" && (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => qualify.mutate({ verdict: "qualified" })}
        className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        <Check size={14} />
        Годен
      </button>

      {/* Причина обязательна: в CRM это резолюция, без неё переход не пройдёт. */}
      <select
        value={reason}
        disabled={busy}
        onChange={(e) => {
          const next = e.target.value;
          setReason(next);
          if (next) qualify.mutate({ verdict: "disqualified", reason: next });
        }}
        className="rounded-lg border border-zinc-200 px-2 py-1 text-sm text-zinc-700 disabled:opacity-50"
      >
        <option value="">Дисквалификация…</option>
        {CRM_DISQUALIFY_REASONS.map((r) => (
          <option key={r.transitionId} value={r.transitionId}>
            {r.name}
          </option>
        ))}
      </select>

      {qualify.error && (
        <span className="text-xs text-red-600">
          {errorMessage(qualify.error)}
        </span>
      )}
    </div>
  );

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PlatformBadge platform={lead.channel?.platform as Platform} />
        {/* Клик — единственный способ увидеть канал, у которого ещё нет ни
            ссылки, ни подписчиков: карточка в дровере сама сходит в TG и
            дозаполнит запись (auto-sync при synced_at IS NULL). */}
        {lead.channel ? (
          <button
            type="button"
            onClick={() => setChannelOpen(true)}
            className="font-medium hover:underline"
          >
            {/* Фолбэк — @username САМОГО КАНАЛА (как channelLabel в
                leads.tsx), не lead.username: там ник админа — другая
                сущность. У несинканного канала title пуст, а username есть. */}
            {lead.channel.title ||
              (lead.channel.username ? `@${lead.channel.username}` : "—")}
          </button>
        ) : (
          <span className="font-medium">{lead.username ?? "—"}</span>
        )}
        {lead.channel?.link && (
          <a
            href={externalHref(lead.channel.link)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
          >
            открыть <ExternalLink size={11} />
          </a>
        )}
        {lead.channel?.memberCount != null && (
          <span className="text-xs text-zinc-500">
            {formatMembers(lead.channel.memberCount)} подписчиков
          </span>
        )}
        {/* Сигналы, на которые смотрит менеджер: реестр и наши отношения.
            РКН — через общий RknBadge: он один знает порог 10к, ниже которого
            регистрация не обязательна и тревожить менеджера незачем. */}
        <RknBadge
          isRkn={lead.channel?.isRkn}
          memberCount={lead.channel?.memberCount}
        />
        {!lead.contactReady && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
            без контакта
          </span>
        )}
        {/* «Уже общались» — сигнал не слать второй холодный опенер прогретому
            админу (cross-project, по всем аккаунтам команды). */}
        {lead.contactHistory?.talked && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
            {lead.contactHistory.replied ? "был диалог" : "уже писали"}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {/* СВОБОДНЫЙ канал, но другим каналом этого же контакта уже
              занимается коллега — предупреждаем до того, как второй менеджер
              напишет тому же человеку. На занятых строках не рисуем: там
              правду говорит плашка «за X» (или это вообще моя строка). */}
          {!lead.assignedTo && props.adminHolder && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
              админ у {props.adminHolder.name}
            </span>
          )}
          {otherClaim && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">
              за {lead.assignedTo!.name}
            </span>
          )}
          {mineClaim && lead.qualification === "pending" && (
            <button
              type="button"
              disabled={claimMut.isPending || props.readOnly}
              onClick={() => claimMut.mutate("unclaim")}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 hover:underline"
            >
              отпустить
            </button>
          )}
          {!lead.assignedTo && lead.qualification === "pending" && (
            <button
              type="button"
              disabled={claimMut.isPending || props.readOnly}
              onClick={() => claimMut.mutate("claim")}
              className="text-[11px] font-medium text-emerald-700 hover:underline"
            >
              взять себе
            </button>
          )}
        </span>
        {claimMut.error && (
          <span className="text-xs text-red-600">
            {errorMessage(claimMut.error)}
          </span>
        )}
      </div>

      {verdictControls && <div className="mt-2">{verdictControls}</div>}

      {/* Вердикт сохранён, но в CRM не уехал — тикета нет, нужен повтор. */}
      {lead.crmSyncError && (
        <CrmRetry
          wsId={props.wsId}
          projectId={props.projectId}
          itemId={lead.id}
          error={lead.crmSyncError}
        />
      )}

      {channelOpen && lead.channel && (
        <ChannelDrawer
          wsId={props.wsId}
          channelId={lead.channel.id}
          onClose={() => setChannelOpen(false)}
          topSlot={
            verdictControls && (
              <div className="border-b border-zinc-100 px-6 py-3">
                {verdictControls}
              </div>
            )
          }
        />
      )}
    </div>
  );
}

export function CrmRetry(props: {
  wsId: string;
  projectId: string;
  itemId: string;
  error: string;
}) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-retry",
        {
          params: {
            path: {
              wsId: props.wsId,
              projectId: props.projectId,
              itemId: props.itemId,
            },
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: () =>
      invalidateProject(qc, props.wsId, props.projectId, { leads: true }),
  });
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
      <AlertTriangle size={12} />
      <span className="min-w-0 flex-1 truncate">CRM: {props.error}</span>
      <button
        type="button"
        onClick={() => retry.mutate()}
        disabled={retry.isPending}
        className="inline-flex items-center gap-1 font-medium hover:underline disabled:opacity-50"
      >
        <RotateCw size={11} />
        повторить
      </button>
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ExternalLink, RotateCw } from "lucide-react";
import { CRM_DISQUALIFY_REASONS } from "@repo/core";
import type { paths } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { invalidateProject } from "../lib/query-keys";
import { RknBadge } from "./channel-badges";
import { formatMembers } from "./channel-card";
import { externalHref } from "../lib/external-href";
import { PlatformBadge, type Platform } from "../lib/platforms";

type LeadsResponse =
  paths["/v1/workspaces/{wsId}/projects/{projectId}/leads"]["get"]["responses"][200]["content"]["application/json"];
type Lead = LeadsResponse["leads"][number];

// Экран квалификации. Строка = КАНАЛ, а не админ: вердикт выносится по каналу
// (накрутки, тематика, живость — свойства площадки), и в CRM тикет тоже заводится
// на канал. Поэтому таблица тут своя, а не общая админ-группированная.
//
// Пока вердикта нет, опенер каналу не уйдёт — это гейт рассылки, а не пометка.

export function QualifyPanel(props: {
  wsId: string;
  projectId: string;
  leads: Lead[];
  /** Логин менеджера в CRM. Пустой — вердикт вынести нельзя (владельца тикета
   *  не проставить), показываем баннер со ссылкой в настройки. */
  crmLogin: string | null;
  readOnly?: boolean;
}) {
  // Панель — очередь «требуют внимания», а не только неотсмотренные. Лид, чей
  // вердикт не доехал до CRM, вердикт уже имеет и в pending не попадает — а
  // именно он и нуждается в действии: тикета в CRM нет, отчётность врёт.
  // Раньше кнопка «повторить» рендерилась только внутри pending-строк, то есть
  // была недостижима вообще.
  const queue = props.leads.filter(
    (l) => l.qualification === "pending" || l.crmSyncError,
  );

  if (!props.crmLogin) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-medium">Укажите свой логин в CRM</div>
        <p className="mt-1 text-xs">
          Вердикт квалификации заводит тикет в CRM Яндекса, и владельцем ставится
          тот, кто его вынес. Без логина этого не сделать — заполните его в
          разделе «Настройки → Интеграции».
        </p>
      </div>
    );
  }

  if (queue.length === 0) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
        Все каналы отсмотрены, и все вердикты доехали до CRM.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {queue.map((lead) => (
        <QualifyRow
          key={lead.id}
          wsId={props.wsId}
          projectId={props.projectId}
          lead={lead}
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
  readOnly?: boolean;
}) {
  const { lead } = props;
  const qc = useQueryClient();
  const [reason, setReason] = useState("");

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
    onSuccess: () =>
      invalidateProject(qc, props.wsId, props.projectId, { leads: true }),
    // Сброс выбора обязателен: иначе после сбоя причина остаётся выбранной, а
    // повторный выбор ТОГО ЖЕ пункта не даёт события change — менеджер не
    // сможет отправить вердикт заново, и это выглядит поломкой кнопки.
    onError: () => setReason(""),
  });

  const busy = qualify.isPending || props.readOnly;

  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PlatformBadge platform={lead.channel?.platform as Platform} />
        <span className="font-medium">
          {lead.channel?.title ?? lead.username ?? "—"}
        </span>
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
      </div>

      {lead.qualification === "pending" && (
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
      )}

      {/* Вердикт сохранён, но в CRM не уехал — тикета нет, нужен повтор. */}
      {lead.crmSyncError && (
        <CrmRetry
          wsId={props.wsId}
          projectId={props.projectId}
          itemId={lead.id}
          error={lead.crmSyncError}
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

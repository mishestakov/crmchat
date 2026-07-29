import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { OUTREACH_QK, invalidateProject } from "../lib/query-keys";

// Статус канала в корп-CRM — вторая ось карточки, независимая от стадии
// канбана: стадия описывает разговор с админом, статус — процесс по каналу.
//
// Кнопки тянем из живой CRM, а не из константы графа: добавят там причину
// отказа — менеджер увидит её сразу, без передеплоя. Если CRM недоступна,
// бэкенд отдаст список из константы (см. crm-transitions).
//
// Плоский <select> вместо кнопки-с-выпадашкой как в интерфейсе CRM — осознанное
// упрощение MVP: работает так же, кода втрое меньше.
export function CrmStatusSelect(props: {
  wsId: string;
  projectId: string;
  itemId: string;
  /** Тикет в CRM заведён — иначе запрос переходов бессмыслен. */
  hasIssue: boolean;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const key = OUTREACH_QK.crmTransitions(
    props.wsId,
    props.projectId,
    props.itemId,
  );

  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-transitions",
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
      return data!;
    },
    // Тикета нет — ходить незачем: ручка вернёт пустой список. crmIssueId уже
    // приезжает в выдаче лидов.
    enabled: props.hasIssue,
    // Живой вызов в CRM (~300 мс) на каждый refocus окна не нужен: статус
    // меняем мы сами, и ответ мутации кладём в кэш ниже.
    staleTime: 60_000,
  });

  const move = useMutation({
    mutationFn: async (transitionId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-transition",
        {
          params: {
            path: {
              wsId: props.wsId,
              projectId: props.projectId,
              itemId: props.itemId,
            },
          },
          body: { transitionId },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      invalidateProject(qc, props.wsId, props.projectId, { leads: true });
    },
  });

  // Тикета ещё нет (лид не прошёл квалификацию) — контрол не показываем:
  // двигать нечего, а пустая выпадашка только путает.
  if (!q.data || q.data.stateId === null) return null;

  return (
    <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
      CRM
      <span className="font-medium text-zinc-700">
        {q.data.stateName ?? q.data.stateId}
      </span>
      <select
        value=""
        disabled={props.disabled || move.isPending}
        onChange={(e) => e.target.value && move.mutate(e.target.value)}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm text-zinc-700 disabled:opacity-50"
      >
        <option value="">Сменить…</option>
        {q.data.options.map((o) => (
          <option key={o.transitionId} value={o.transitionId}>
            {o.label}
          </option>
        ))}
      </select>
      {move.error && (
        <span className="text-red-600">{errorMessage(move.error)}</span>
      )}
    </label>
  );
}

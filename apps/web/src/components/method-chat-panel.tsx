import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Send } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";

// Чат «способа связи через чат» (этап 16.9): группа обсуждения ИЛИ личка канала.
// История с отправителями (senderName на входящих — в группе пишут разные
// участники) + отправка через аккаунт-участника. `target` задаёт намерение
// явно (каталоговая личка != группа), оно же уходит в ручки method-*, чтобы
// сервер резолвил ту же цель. Платная личка (target=dm, starCost>0) → read-only:
// показываем тред, но писать из CRM нельзя (звёзды тратятся вручную в Telegram).
export function MethodChatPanel({
  wsId,
  channelId,
  target,
  starCost,
}: {
  wsId: string;
  channelId: string;
  target: "group" | "dm";
  // Только для лички: 0 → бесплатно, >0 → read-only (вручную), null → не синкали.
  starCost?: number | null;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  // queryKey включает target: один канал может быть и группой (плейсмент), и
  // личкой (каталог) — кэши не должны смешиваться.
  const historyKey = ["method-history", wsId, channelId, target] as const;
  const readOnly = target === "dm" && starCost != null && starCost > 0;
  const historyQ = useQuery({
    queryKey: historyKey,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}/method-history",
        {
          params: { path: { wsId, id: channelId }, query: { limit: 50, target } },
        },
      );
      if (error) throw error;
      return data.messages;
    },
    staleTime: 60 * 1000,
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/method-send",
        {
          params: { path: { wsId, id: channelId } },
          body: { text: text.trim(), target },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: historyKey });
    },
  });
  // TDLib отдаёт newest-first → разворачиваем в oldest-first для рендера.
  const ordered = [...(historyQ.data ?? [])].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-zinc-50 px-3 py-3">
        {historyQ.isLoading ? (
          <p className="text-center text-sm text-zinc-400">Загрузка…</p>
        ) : historyQ.error ? (
          <div className="px-2 py-4 text-center text-sm text-red-600">
            <p>Чат недоступен через привязанный аккаунт.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Возможно, аккаунт вышел из группы/лички — перепривяжите способ связи
              или выберите другой.
            </p>
            <p className="mt-1 text-[11px] text-zinc-400">
              {errorMessage(historyQ.error)}
            </p>
          </div>
        ) : ordered.length === 0 ? (
          <p className="text-center text-sm text-zinc-400">Сообщений нет</p>
        ) : (
          ordered.map((m) => (
            <div
              key={m.id}
              className={"flex " + (m.isOutgoing ? "justify-end" : "justify-start")}
            >
              <div
                className={
                  "max-w-[80%] rounded-2xl px-3 py-1.5 text-sm " +
                  (m.isOutgoing
                    ? "bg-emerald-100 text-zinc-900"
                    : "bg-white ring-1 ring-zinc-200")
                }
              >
                {!m.isOutgoing && (
                  <div className="text-[11px] font-medium text-emerald-700">
                    {m.senderName}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{m.text}</div>
                <div className="mt-0.5 text-right text-[10px] text-zinc-400">
                  {new Date(m.date).toLocaleString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {readOnly ? (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">
          Платная личка ({starCost}⭐) — отправьте вручную в Telegram.
        </div>
      ) : (
        <>
          <div className="flex items-end gap-2 border-t border-zinc-200 p-2">
            <textarea
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Сообщение…"
              className="min-h-0 flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={!text.trim() || send.isPending}
              className="rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Send size={16} />
            </button>
          </div>
          {send.error && (
            <p className="px-2 pb-1 text-xs text-red-600">
              {errorMessage(send.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

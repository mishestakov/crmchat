import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useEventSourceEvent } from "../lib/hooks";
import { useChatDraft } from "../lib/use-chat-draft";
import { ChatComposer } from "./chat-composer";

// Переписка MAX-контакта (#5): история через max-сессию (лёгкий поллинг для
// realtime входящих) + composer. Своя панель — TG-фич (теги/upload/bot/sticky)
// тут нет. Рендерится из ChatPanel, когда контакт привязан только по MAX.
export function MaxChatBody(props: {
  wsId: string;
  contactId: string;
  displayName: string;
}) {
  const qc = useQueryClient();
  const { text, setText, clear } = useChatDraft(
    `max:${props.wsId}:${props.contactId}`,
  );

  const historyQ = useQuery({
    queryKey: ["max-history", props.wsId, props.contactId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}/max-history",
        { params: { path: { wsId: props.wsId, id: props.contactId } } },
      );
      if (error) throw error;
      return data!;
    },
    // Поллинг — fallback; основной realtime через SSE ниже (как TG-панель).
    refetchInterval: 15000,
  });

  // Push входящих: NOTIF_MESSAGE-listener шлёт contact-event → инвалидируем
  // ленту мгновенно (та же SSE-машина, что у TG-переписки).
  useEventSourceEvent<{ contactId: string }>(
    `/v1/workspaces/${props.wsId}/contact-stream`,
    "contact",
    (ev) => {
      if (ev.contactId === props.contactId) {
        qc.invalidateQueries({
          queryKey: ["max-history", props.wsId, props.contactId],
        });
      }
    },
  );

  const sendMut = useMutation({
    mutationFn: async (raw: string) => {
      const t = raw.trim();
      if (!t) throw new Error("Пустое сообщение");
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/max-send",
        {
          params: { path: { wsId: props.wsId, id: props.contactId } },
          body: { text: t },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      clear();
      qc.invalidateQueries({
        queryKey: ["max-history", props.wsId, props.contactId],
      });
    },
  });

  const messages = historyQ.data?.messages ?? [];
  const peer = historyQ.data?.peer;
  const name = peer?.name || props.displayName;

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2">
        {peer?.avatarUrl ? (
          <img
            src={peer.avatarUrl}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-medium text-violet-700">
            {(name[0] ?? "?").toUpperCase()}
          </span>
        )}
        <span className="text-sm font-medium">{name}</span>
        <span className="text-xs font-normal text-violet-600">· MAX</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {historyQ.isLoading && (
          <p className="text-sm text-zinc-400">Загрузка переписки…</p>
        )}
        {historyQ.error && (
          <p className="text-sm text-red-600">{errorMessage(historyQ.error)}</p>
        )}
        {historyQ.isSuccess && messages.length === 0 && (
          <p className="text-sm text-zinc-400">Переписки пока нет.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.outgoing ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${
                m.outgoing
                  ? "bg-violet-600 text-white"
                  : "bg-zinc-100 text-zinc-900"
              }`}
            >
              {m.text || <span className="opacity-60">[без текста]</span>}
              <div
                className={`mt-0.5 text-[10px] ${
                  m.outgoing ? "text-violet-200" : "text-zinc-400"
                }`}
              >
                {new Date(m.time).toLocaleTimeString("ru-RU", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-100 p-3">
        <ChatComposer
          accent="violet"
          value={text}
          onChange={setText}
          onSend={() => sendMut.mutate(text)}
          sending={sendMut.isPending}
          placeholder="Сообщение в MAX…"
          error={sendMut.error ? errorMessage(sendMut.error) : null}
        />
      </div>
    </div>
  );
}

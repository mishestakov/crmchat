import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  MessageCircle,
  Send,
  X,
} from "lucide-react";
import type { Contact } from "@repo/core";
import { api } from "../lib/api";
import { formatDateTime, formatHHMM, formatRelative } from "../lib/date-utils";
import { errorMessage } from "../lib/errors";
import { useEventSourceEvent } from "../lib/hooks";
import {
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  renderMessageEntities,
} from "../lib/tg-message";

// Drawer переписки + quick send. Принимает Contact, тянет chat-history через
// /contacts/{id}/chat-history, показывает табы аккаунтов из contact.chatAccounts.
// После 5A (eager-конверсия лидов в контакты на импорте) lead-no-contact режим
// не нужен — у любого лида в проекте уже есть привязанный contact.

export type AccountRow = {
  id: string;
  firstName: string | null;
  tgUsername: string | null;
  phoneNumber: string | null;
};

export function formatAccount(a: AccountRow): string {
  if (a.firstName) return a.firstName;
  if (a.tgUsername) return `@${a.tgUsername}`;
  if (a.phoneNumber) return a.phoneNumber;
  return a.id;
}

function contactFullName(contact: Contact): string {
  const v = contact.properties as Record<string, unknown>;
  return typeof v.full_name === "string" ? v.full_name : "";
}

type ChatMessage = {
  id: string;
  date: string;
  isOutgoing: boolean;
  text: string;
  entities: MessageEntity[];
  mediaThumb: MessageThumb | null;
};

export function ChatDrawer(props: {
  wsId: string;
  contact: Contact;
  accountId: string;
  accounts: AccountRow[];
  onSelectAccount: (accountId: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const accountById = new Map(props.accounts.map((a) => [a.id, a]));

  const displayName = contactFullName(props.contact) || "—";
  const peerKey = props.contact.id;

  // Identifier для deep-link на /outreach/chat. Приоритет: tg_user_id (точно)
  // → username (CSV-импорт по @ без резолва). Без обоих кнопка скрыта.
  const peerLink = ((): { peerUserId: string } | { peerUsername: string } | null => {
    const v = props.contact.properties as Record<string, unknown>;
    if (typeof v.tg_user_id === "string") {
      return { peerUserId: v.tg_user_id };
    }
    if (typeof v.telegram_username === "string" && v.telegram_username) {
      return { peerUsername: v.telegram_username.replace(/^@/, "") };
    }
    return null;
  })();

  // Preview активных проектов: бэк находит project_items.tg_user_id и считает
  // pending'и. Если у peer'а есть pending'и → warning перед отправкой.
  const previewQ = useQuery({
    queryKey: ["quick-send-preview", props.wsId, peerKey] as const,
    queryFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/quick-send/preview",
        {
          params: { path: { wsId: props.wsId } },
          body: { contactId: props.contact.id },
        },
      );
      if (error) throw error;
      return data!.activeProjects;
    },
    staleTime: 30_000,
  });

  const [composeText, setComposeText] = useState("");
  const sendMut = useMutation({
    mutationFn: async () => {
      const text = composeText.trim();
      if (!text) throw new Error("Пустое сообщение");
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/quick-send",
        {
          params: { path: { wsId: props.wsId } },
          body: {
            accountId: props.accountId,
            contactId: props.contact.id,
            text,
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      setComposeText("");
      qc.invalidateQueries({
        queryKey: ["chat-history", props.wsId, props.contact.id],
      });
      qc.invalidateQueries({
        queryKey: ["quick-send-preview", props.wsId, peerKey],
      });
    },
  });

  // Esc → закрыть.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const initialQ = useQuery({
    queryKey: [
      "chat-history",
      props.wsId,
      props.contact.id,
      props.accountId,
    ] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/contacts/{id}/chat-history",
        {
          params: {
            path: { wsId: props.wsId, id: props.contact.id },
            query: { accountId: props.accountId, limit: 50 },
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    staleTime: 60_000,
  });

  // closeChat: TDLib держит чат «открытым» с момента первого fetch
  // chat-history — без явного close там копятся background-push'и по
  // неактуальным peer'ам. Cleanup срабатывает на закрытии drawer'а и на
  // смене accountId; следующий openChat нового accountId произойдёт
  // автоматически на refetch.
  const targetContactId = props.contact.id;
  useEffect(() => {
    const wsId = props.wsId;
    const accountId = props.accountId;
    return () => {
      void api
        .POST("/v1/workspaces/{wsId}/contacts/{id}/chat/close", {
          params: { path: { wsId, id: targetContactId } },
          body: { accountId },
        })
        .catch((e: unknown) =>
          console.error("[chat-drawer] closeChat:", e),
        );
    };
  }, [props.wsId, props.accountId, targetContactId]);

  // Перетягиваем chat-history на любое contact event (новое сообщение,
  // read-receipt, удаление) — listener конвертит TDLib updates в SSE.
  useEventSourceEvent<{ contactId: string }>(
    `/v1/workspaces/${props.wsId}/contact-stream`,
    "contact",
    (ev) => {
      if (ev.contactId === props.contact.id) {
        qc.invalidateQueries({
          queryKey: [
            "chat-history",
            props.wsId,
            props.contact.id,
            props.accountId,
          ],
        });
      }
    },
  );

  const [olderPages, setOlderPages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoScrollRef = useRef(false);
  // Был ли юзер «у дна» в момент последнего scroll-event'а — для auto-scroll
  // на новое входящее/исходящее сообщение из SSE.
  const wasNearBottomRef = useRef(true);

  useEffect(() => {
    setOlderPages([]);
    setHasMore(true);
    setLoadMoreError(null);
    setLoadingMore(false);
    didAutoScrollRef.current = false;
  }, [props.accountId]);

  useEffect(() => {
    if (initialQ.data && initialQ.data.messages.length === 0) setHasMore(false);
  }, [initialQ.data]);

  const messages: ChatMessage[] = initialQ.data
    ? [...olderPages, ...initialQ.data.messages.toReversed()]
    : olderPages;
  const lastReadOutboxId = initialQ.data?.lastReadOutboxId ?? null;
  const peerStatus = initialQ.data?.peerStatus ?? null;

  useEffect(() => {
    if (!initialQ.isSuccess) return;
    if (didAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didAutoScrollRef.current = true;
  }, [initialQ.isSuccess]);

  // Auto-scroll к низу на новое сообщение, только если юзер уже у дна.
  const newestId = initialQ.data?.messages[0]?.id ?? null;
  useEffect(() => {
    if (!didAutoScrollRef.current) return;
    if (!wasNearBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
  }, [newestId]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    wasNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (!initialQ.isSuccess || !hasMore || loadingMore) return;
    if (el.scrollTop > 50) return;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    const prevHeight = el.scrollHeight;
    const contactId = props.contact.id;
    api
      .GET("/v1/workspaces/{wsId}/contacts/{id}/chat-history", {
        params: {
          path: { wsId: props.wsId, id: contactId },
          query: {
            accountId: props.accountId,
            limit: 50,
            before: oldestId,
          },
        },
      })
      .then(({ data, error }) => {
        if (error) throw error;
        const page = data!.messages;
        if (page.length === 0) {
          setHasMore(false);
        } else {
          setOlderPages((prev) => [...page.toReversed(), ...prev]);
          requestAnimationFrame(() => {
            if (!scrollRef.current) return;
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevHeight;
          });
        }
        setLoadingMore(false);
      })
      .catch((e) => {
        setLoadMoreError(e);
        setLoadingMore(false);
      });
  };

  const chatAccounts = props.contact.chatAccounts;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/20"
        onClick={props.onClose}
      />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[480px] max-w-[90vw] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-medium">{displayName}</div>
            <div className="text-xs text-zinc-500">
              {formatPeerStatus(peerStatus) ?? "История переписки"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {peerLink && (
              <Link
                to="/w/$wsId/outreach/chat"
                params={{ wsId: props.wsId }}
                search={{ accountId: props.accountId, ...peerLink }}
                title="Открыть полноценный TG-чат (поддерживает медиа, файлы, реакции)"
                className="inline-flex items-center gap-1 rounded-full bg-[#229ED9] px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-[#1B89BD]"
              >
                <MessageCircle size={14} />
                Открыть в чате
              </Link>
            )}
            <button
              type="button"
              onClick={props.onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        {chatAccounts.length > 1 && (
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-2">
            {chatAccounts.map((ca) => {
              const acc = accountById.get(ca.accountId);
              const active = ca.accountId === props.accountId;
              return (
                <button
                  type="button"
                  key={ca.accountId}
                  onClick={() => props.onSelectAccount(ca.accountId)}
                  className={
                    "rounded-md px-2 py-1 text-xs font-medium " +
                    (active
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
                  }
                >
                  {acc ? formatAccount(acc) : ca.accountId}
                </button>
              );
            })}
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto bg-zinc-50 p-4"
        >
          <>
            {initialQ.isLoading && (
              <p className="text-sm text-zinc-400">Загрузка истории…</p>
            )}
            {initialQ.error && (
              <p className="text-sm text-red-600">
                {errorMessage(initialQ.error)}
              </p>
            )}
            {initialQ.isSuccess && messages.length === 0 && (
              <p className="text-sm text-zinc-400">
                Сообщений нет — этот аккаунт ещё не общался с контактом.
              </p>
            )}
              {messages.length > 0 && (
                <div className="flex flex-col gap-2">
                  {loadingMore && (
                    <p className="text-center text-xs text-zinc-400">
                      Подгружаем старые…
                    </p>
                  )}
                  {loadMoreError != null && (
                    <p className="text-center text-xs text-red-600">
                      {errorMessage(loadMoreError)}
                    </p>
                  )}
                  {!hasMore && !loadingMore && (
                    <p className="text-center text-xs text-zinc-400">
                      Это начало переписки
                    </p>
                  )}
                  {messages.map((m) => {
                    const readByPeer =
                      m.isOutgoing && isIdAtMost(m.id, lastReadOutboxId);
                    return (
                      <div
                        key={m.id}
                        className={
                          "max-w-[80%] overflow-hidden rounded-lg text-sm " +
                          (m.isOutgoing
                            ? "ml-auto bg-emerald-600 text-white"
                            : "mr-auto bg-white text-zinc-900 ring-1 ring-zinc-200")
                        }
                      >
                        {m.mediaThumb && (
                          <MessageMediaThumb thumb={m.mediaThumb} />
                        )}
                        <div className="px-3 py-2">
                          {m.text && (
                            <div className="whitespace-pre-wrap break-words">
                              {renderMessageEntities(m.text, m.entities)}
                            </div>
                          )}
                          <div
                            className={
                              (m.text ? "mt-1 " : "") +
                              "flex items-center justify-end gap-0.5 text-[10px] " +
                              (m.isOutgoing
                                ? "text-emerald-100"
                                : "text-zinc-400")
                            }
                            title={formatDateTime(m.date)}
                          >
                            <span>{formatHHMM(m.date)}</span>
                            {m.isOutgoing &&
                              (readByPeer ? (
                                <CheckCheck size={12} />
                              ) : (
                                <Check size={12} />
                              ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </>
        </div>
        <ComposeFooter
          activeProjects={previewQ.data ?? []}
          accountLabel={
            accountById.get(props.accountId)
              ? formatAccount(accountById.get(props.accountId)!)
              : props.accountId
          }
          text={composeText}
          onTextChange={setComposeText}
          onSend={() => sendMut.mutate()}
          sending={sendMut.isPending}
          error={sendMut.error ? errorMessage(sendMut.error) : null}
        />
      </aside>
    </>
  );
}

function ComposeFooter(props: {
  activeProjects: { id: string; name: string }[];
  accountLabel: string;
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  error: string | null;
}) {
  const canSend = props.text.trim().length > 0 && !props.sending;
  return (
    <div className="border-t border-zinc-200 bg-white p-3">
      {props.activeProjects.length > 0 && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <div>
            Этот контакт в авто-цепочках:{" "}
            <span className="font-medium">
              {props.activeProjects.map((p) => p.name).join(", ")}
            </span>
            . После ручной отправки автоматика для него остановится.
          </div>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={props.text}
          rows={2}
          placeholder={`Написать через ${props.accountLabel}…`}
          onChange={(e) => props.onTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter — отправка. Shift+Enter — перенос строки (нативный
            // textarea-behavior, не перехватываем).
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              props.onSend();
            }
          }}
          className="flex-1 resize-none rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={props.onSend}
          disabled={!canSend}
          title="Отправить (Enter); перенос — Shift+Enter"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </div>
      {props.error && (
        <p className="mt-1 text-xs text-red-600">{props.error}</p>
      )}
    </div>
  );
}

// Сравнение message.id <= lastReadOutboxId через BigInt — TG-message-id
// 64-битные, Number теряет точность на ~2^53.
function isIdAtMost(id: string, threshold: string | null): boolean {
  if (!threshold) return false;
  try {
    return BigInt(id) <= BigInt(threshold);
  } catch {
    return false;
  }
}

// lastSeenAt=null + isOnline=false означает userStatusRecently/LastWeek/
// LastMonth — точную дату TDLib не даёт, показываем «был недавно».
function formatPeerStatus(
  status: { isOnline: boolean; lastSeenAt: string | null } | null,
): string | null {
  if (!status) return null;
  if (status.isOnline) return "в сети";
  if (!status.lastSeenAt) return "был недавно";
  return `был ${formatRelative(status.lastSeenAt)}`;
}

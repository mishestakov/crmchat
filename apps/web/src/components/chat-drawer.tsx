import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Download,
  FileText,
  Hash,
  Pin,
  Tag,
  Users,
  X,
} from "lucide-react";
import type { Contact } from "@repo/core";
import { api, sendContactDocument } from "../lib/api";
import {
  formatDateTime,
  formatHHMM,
  formatPastRelative,
  formatRelative,
} from "../lib/date-utils";
import { errorMessage } from "../lib/errors";
import { formatFileSize } from "../lib/format";
import { useEventSourceEvent } from "../lib/hooks";
import { ChannelDrawer } from "./channel-drawer";
import { ChatComposer } from "./chat-composer";
import { Drawer } from "./drawer";
import { MaxChatBody } from "./max-chat-body";
import {
  FullResMedia,
  type MessageEntity,
  MessageMediaThumb,
  type MessageThumb,
  ReactionChips,
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

type ReplyButton = {
  text: string;
  action: "url" | "send_text" | "unsupported";
  url?: string;
};
type ReplyMarkup = { kind: "inline" | "keyboard"; rows: ReplyButton[][] };

type ChatDocument = {
  fileId: number;
  fileName: string;
  mimeType: string;
  size: number;
};
type ChatMessage = {
  id: string;
  date: string;
  isOutgoing: boolean;
  text: string;
  entities: MessageEntity[];
  mediaThumb: MessageThumb | null;
  media: { kind: "photo" | "video"; width: number; height: number } | null;
  document: ChatDocument | null;
  reactions: { emoji: string; count: number }[];
  replyMarkup: ReplyMarkup | null;
  albumId: string | null;
};

// Пометка сообщения как артефакта фазы «Запуск» (опц. в ChatPanel).
export type MessageTagKind = "contract" | "creative" | "act";
export const MESSAGE_TAG_LABEL: Record<MessageTagKind, string> = {
  contract: "Договор",
  creative: "Креатив",
  act: "Акт",
};
export type MessageTagRef = {
  chatId: string;
  messageId: string;
  albumId: string | null;
  accountId: string;
};

// Оверлей-обёртка: Drawer вокруг ChatPanel (Esc живёт в Drawer-стеке, не в
// панели: встроенная панель не должна перехватывать Esc у родителя).
// Используется из контактов / лидов / канбана; для side-by-side (лонглист)
// панель встраивается напрямую через ChatPanel.
export function ChatDrawer(props: {
  wsId: string;
  contact: Contact;
  accountId: string;
  accounts: AccountRow[];
  onSelectAccount: (accountId: string) => void;
  onClose: () => void;
}) {
  return (
    <Drawer width={480} onClose={props.onClose}>
      <ChatPanel {...props} />
    </Drawer>
  );
}

// Начинка чата без позиционирования: шапка + лента + composer как flex-колонка.
// onClose опционален — в drawer-режиме рисует X в шапке; во встроенном (рядом с
// карточкой подбора) X скрыт, закрывает родитель.
export function ChatPanel(props: {
  wsId: string;
  contact: Contact;
  accountId: string;
  accounts: AccountRow[];
  onSelectAccount: (accountId: string) => void;
  onClose?: () => void;
  // Фаза «Запуск»: пометка сообщения как договор/креатив/акт. Если передан —
  // у каждого сообщения появляется кнопка «пометить». Альбом группируется по
  // albumId. taggedKindByMessageId рисует бейдж на уже помеченных.
  onTagMessage?: (kind: MessageTagKind, ref: MessageTagRef) => void;
  taggedKindByMessageId?: Record<string, MessageTagKind>;
  // Прыжок к сообщению (фаза «Запуск»: клик «открыть в чате» из карточки). nonce
  // меняется при каждом клике, чтобы повторный прыжок к тому же id сработал.
  jumpTo?: { messageId: string; nonce: number } | null;
}) {
  const qc = useQueryClient();
  const accountById = new Map(props.accounts.map((a) => [a.id, a]));

  const displayName = contactFullName(props.contact) || "—";
  const peerKey = props.contact.id;
  // Карточка канала рядом с перепиской (T3.1): чипы каналов админа в шапке,
  // клик открывает ChannelDrawer поверх чата — менеджер смотрит канал и
  // диалог, не уходя из переписки.
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);

  // MAX-контакт (привязан по max.ru/u): своя переписка через MAX-сессию, TG-
  // запросы (preview/chat-history) гасим и рендерим MaxChatBody ниже. Двойная
  // TG+MAX идентичность → предпочитаем TG (established primary), чтобы не
  // прятать TG-переписку.
  const cprops = props.contact.properties as Record<string, unknown> | null;
  const isMax =
    !!(cprops?.max_link || cprops?.max_user_id) && !cprops?.tg_user_id;

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
    enabled: !isMax,
  });

  const stickyMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.PATCH(
        "/v1/workspaces/{wsId}/contacts/{id}/sticky",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: { accountId: props.accountId },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["contact", props.wsId, props.contact.id],
      });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const [composeText, setComposeText] = useState("");
  const sendMut = useMutation({
    // Текст — параметр: composer шлёт черновик, reply-кнопка бота шлёт свой text.
    mutationFn: async (raw: string) => {
      const text = raw.trim();
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

  // Drag-drop файла → отправка документом (бэкенд шлёт через TDLib). Тег
  // ставится вручную из чата после доставки. dragDepth — счётчик enter/leave
  // (leave летит и от дочерних элементов, булев флаг мигал бы).
  const [dragDepth, setDragDepth] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      await sendContactDocument(
        props.wsId,
        props.contact.id,
        props.accountId,
        file,
      );
      qc.invalidateQueries({
        queryKey: [
          "chat-history",
          props.wsId,
          props.contact.id,
          props.accountId,
        ],
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Ошибка отправки файла");
    } finally {
      setUploading(false);
    }
  };

  // Старт бота (этап 16.9): первое действие в пустом бот-диалоге. После — бот
  // присылает меню/приветствие, перетягиваем историю.
  const botStartMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/bot-start",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: { accountId: props.accountId },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["chat-history", props.wsId, props.contact.id],
      });
    },
  });

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
    enabled: !isMax,
  });

  // closeChat: TDLib держит чат «открытым» с момента первого fetch
  // chat-history — без явного close там копятся background-push'и по
  // неактуальным peer'ам. Cleanup срабатывает на закрытии drawer'а и на
  // смене accountId; следующий openChat нового accountId произойдёт
  // автоматически на refetch.
  const targetContactId = props.contact.id;
  useEffect(() => {
    // MAX-контакт TDLib-чат не открывал — closeChat не шлём (иначе спурный
    // POST с TG-accountId на размонтировании MAX-переписки).
    if (isMax) return;
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
  }, [props.wsId, props.accountId, targetContactId, isMax]);

  // Перетягиваем chat-history на любое contact event (новое сообщение,
  // read-receipt, удаление) — listener конвертит TDLib updates в SSE. Для MAX
  // эту подписку не открываем (MaxChatBody держит свою).
  useEventSourceEvent<{ contactId: string }>(
    isMax ? null : `/v1/workspaces/${props.wsId}/contact-stream`,
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
  // Прыжок к сообщению: refs по messageId + подсветка скроллнутого пузыря.
  const msgRefs = useRef(new Map<string, HTMLDivElement>());
  const [highlightId, setHighlightId] = useState<string | null>(null);

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
  const peerIsBot = initialQ.data?.peerIsBot ?? false;
  const chatId = initialQ.data?.chatId ?? null;

  // Пометка сообщения (фаза «Запуск»). Альбом не собираем на фронте — храним
  // albumId, сервер дочитает весь альбом при рендере (надёжнее: не зависим от
  // того, что подгружено в чате).
  const [tagMenuFor, setTagMenuFor] = useState<string | null>(null);
  const tagMessage = (m: ChatMessage, kind: MessageTagKind) => {
    if (!chatId || !props.onTagMessage) return;
    props.onTagMessage(kind, {
      chatId,
      messageId: m.id,
      albumId: m.albumId,
      accountId: props.accountId,
    });
    setTagMenuFor(null);
  };

  useEffect(() => {
    if (!initialQ.isSuccess) return;
    if (didAutoScrollRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    didAutoScrollRef.current = true;
  }, [initialQ.isSuccess]);

  // Прыжок к сообщению по клику «открыть в чате». Сообщение должно быть в окне
  // (свежий договор — в последних 50); если не подгружено — тихо ничего.
  const jumpNonce = props.jumpTo?.nonce;
  const jumpMessageId = props.jumpTo?.messageId;
  useEffect(() => {
    if (jumpNonce == null || !jumpMessageId) return;
    const el = msgRefs.current.get(jumpMessageId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(jumpMessageId);
    const t = setTimeout(() => setHighlightId(null), 1800);
    return () => clearTimeout(t);
  }, [jumpNonce, jumpMessageId]);

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

  // Свежее MAX(lastInboundAt, lastOutboundAt) среди других аккаунтов:
  // если коллега общался с peer'ом позже, чем мы на текущем — показываем
  // плашку. Antidublе-сигнал «коллега в коммуникации, не дёргай повторно».
  const myMax = maxChatActivity(
    chatAccounts.find((ca) => ca.accountId === props.accountId),
  );
  const fresherColleague = chatAccounts
    .filter((ca) => ca.accountId !== props.accountId)
    .map((ca) => ({ accountId: ca.accountId, at: maxChatActivity(ca) }))
    .filter((c) => c.at != null && (myMax == null || c.at > myMax))
    .sort((a, b) => (a.at! > b.at! ? -1 : 1))[0];
  const colleagueLabel = fresherColleague
    ? (() => {
        const acc = accountById.get(fresherColleague.accountId);
        return acc ? formatAccount(acc) : fresherColleague.accountId;
      })()
    : null;

  if (isMax) {
    return (
      <MaxChatBody
        wsId={props.wsId}
        contactId={props.contact.id}
        displayName={displayName}
      />
    );
  }

  return (
    <div
      className="relative flex h-full flex-col bg-white"
      onDragEnter={(e) => {
        if (!chatId) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        if (chatId) e.preventDefault();
      }}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        if (!chatId) return;
        e.preventDefault();
        setDragDepth(0);
        const f = e.dataTransfer.files?.[0];
        if (f) void uploadFile(f);
      }}
    >
        {(dragDepth > 0 || uploading) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-emerald-50/90 text-sm font-medium text-emerald-700">
            {uploading ? "Отправляем файл…" : "Отпустите — отправить файл в чат"}
          </div>
        )}
        {uploadError && (
          <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">
            <span className="truncate">{uploadError}</span>
            <button
              type="button"
              onClick={() => setUploadError(null)}
              className="shrink-0 text-red-400 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-medium text-sky-700">
              {(displayName[0] ?? "?").toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">{displayName}</div>
              <div className="text-xs text-zinc-500">
                {formatPeerStatus(peerStatus) ?? "История переписки"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {props.contact.primaryAccountId !== props.accountId && (
              <button
                type="button"
                disabled={stickyMut.isPending}
                onClick={() => stickyMut.mutate()}
                title="Закрепить контакт за этим аккаунтом — следующие касания пойдут через него"
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
              >
                <Pin size={12} />
                Закрепить за аккаунтом
              </button>
            )}
            {props.onClose && (
              <button
                type="button"
                onClick={props.onClose}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        {props.contact.channels.length > 0 && (
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 px-3 py-1.5">
            {props.contact.channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => setOpenChannelId(ch.id)}
                title="Открыть карточку канала"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-200"
              >
                <Hash size={11} className="text-zinc-400" />
                {ch.title}
              </button>
            ))}
          </div>
        )}
        {fresherColleague && (
          <button
            type="button"
            onClick={() => props.onSelectAccount(fresherColleague.accountId)}
            className="flex w-full items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-left text-xs text-amber-900 hover:bg-amber-100"
            title="Открыть переписку коллеги"
          >
            <Users size={14} className="shrink-0" />
            <span>
              Коллега <span className="font-medium">{colleagueLabel}</span> писал
              этому контакту {formatPastRelative(fresherColleague.at!)}
            </span>
          </button>
        )}
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
              peerIsBot ? (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <p className="text-sm text-zinc-400">
                    Диалога с ботом ещё нет. Запустите его, чтобы получить меню.
                  </p>
                  <button
                    type="button"
                    disabled={botStartMut.isPending}
                    onClick={() => botStartMut.mutate()}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {botStartMut.isPending ? "Запускаем…" : "Запустить бота"}
                  </button>
                  {botStartMut.error != null && (
                    <p className="text-xs text-red-600">
                      {errorMessage(botStartMut.error)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-zinc-400">
                  Сообщений нет — этот аккаунт ещё не общался с контактом.
                </p>
              )
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
                        ref={(el) => {
                          const map = msgRefs.current;
                          if (el) map.set(m.id, el);
                          else map.delete(m.id);
                        }}
                        className={
                          "group flex max-w-[85%] flex-col gap-1 " +
                          (m.isOutgoing
                            ? "ml-auto items-end"
                            : "mr-auto items-start")
                        }
                      >
                        <div
                          className={
                            "overflow-hidden rounded-lg text-sm transition-shadow " +
                            (m.isOutgoing
                              ? "bg-emerald-600 text-white "
                              : "bg-white text-zinc-900 ") +
                            (highlightId === m.id
                              ? "ring-2 ring-amber-400"
                              : m.isOutgoing
                                ? ""
                                : "ring-1 ring-zinc-200")
                          }
                        >
                          {m.media ? (
                            <FullResMedia
                              src={
                                `/v1/workspaces/${props.wsId}/contacts/${props.contact.id}/chat-media/${m.id}` +
                                `?accountId=${encodeURIComponent(props.accountId)}`
                              }
                              thumb={m.mediaThumb}
                              kind={m.media.kind}
                              width={m.media.width}
                              height={m.media.height}
                            />
                          ) : (
                            m.mediaThumb && <MessageMediaThumb thumb={m.mediaThumb} />
                          )}
                          <div className="px-3 py-2">
                            {m.document && (
                              <a
                                href={
                                  `/v1/workspaces/${props.wsId}/contacts/${props.contact.id}/chat-file` +
                                  `?accountId=${encodeURIComponent(props.accountId)}` +
                                  `&fileId=${m.document.fileId}` +
                                  `&name=${encodeURIComponent(m.document.fileName)}` +
                                  `&mime=${encodeURIComponent(m.document.mimeType)}`
                                }
                                download={m.document.fileName}
                                className={
                                  "mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 " +
                                  (m.isOutgoing
                                    ? "bg-emerald-700/40 hover:bg-emerald-700/70"
                                    : "bg-zinc-100 hover:bg-zinc-200")
                                }
                              >
                                <FileText size={18} className="mt-0.5 shrink-0" />
                                <span className="min-w-0 flex-1">
                                  <span className="block break-all font-medium">
                                    {m.document.fileName}
                                  </span>
                                  <span className="block text-[10px] opacity-70">
                                    {formatFileSize(m.document.size)}
                                  </span>
                                </span>
                                <Download size={15} className="mt-0.5 shrink-0 opacity-70" />
                              </a>
                            )}
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
                        <ReactionChips reactions={m.reactions} />
                        {m.replyMarkup && (
                          <ReplyMarkupButtons
                            markup={m.replyMarkup}
                            onSendText={(t) => sendMut.mutate(t)}
                            disabled={sendMut.isPending}
                          />
                        )}
                        {props.onTagMessage && (
                          <div className="flex items-center gap-1">
                            {props.taggedKindByMessageId?.[m.id] && (
                              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
                                {MESSAGE_TAG_LABEL[
                                  props.taggedKindByMessageId[m.id]!
                                ]}
                              </span>
                            )}
                            {tagMenuFor === m.id ? (
                              <div className="flex items-center gap-1">
                                {(
                                  ["contract", "creative", "act"] as const
                                ).map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() => tagMessage(m, k)}
                                    className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50"
                                  >
                                    {MESSAGE_TAG_LABEL[k]}
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setTagMenuFor(null)}
                                  className="px-0.5 text-[10px] text-zinc-400 hover:text-zinc-600"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setTagMenuFor(m.id)}
                                disabled={!chatId}
                                className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-zinc-400 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100 disabled:opacity-0"
                              >
                                <Tag size={11} /> пометить
                              </button>
                            )}
                          </div>
                        )}
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
          onSend={() => sendMut.mutate(composeText)}
          sending={sendMut.isPending}
          error={sendMut.error ? errorMessage(sendMut.error) : null}
        />
        {openChannelId && (
          <ChannelDrawer
            wsId={props.wsId}
            channelId={openChannelId}
            onClose={() => setOpenChannelId(null)}
          />
        )}
    </div>
  );
}

// Бот-кнопки (этап 16.9): url → ссылка, send_text → нажатие шлёт текст,
// unsupported (callback/webapp/оплата/…) → серым с подсказкой «только в
// Telegram-приложении» (в MVP не обрабатываем, см. AskUserQuestion).
function ReplyMarkupButtons(props: {
  markup: ReplyMarkup;
  onSendText: (text: string) => void;
  disabled: boolean;
}) {
  const base =
    "rounded-md px-2.5 py-1 text-xs font-medium ring-1 transition-colors";
  return (
    <div className="flex w-full flex-col gap-1">
      {props.markup.rows.map((row, ri) => (
        <div key={ri} className="flex flex-wrap gap-1">
          {row.map((b, bi) => {
            if (b.action === "url" && b.url) {
              return (
                <a
                  key={bi}
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className={base + " bg-white text-[#229ED9] ring-zinc-300 hover:bg-zinc-50"}
                >
                  {b.text} ↗
                </a>
              );
            }
            if (b.action === "send_text") {
              return (
                <button
                  key={bi}
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.onSendText(b.text)}
                  className={base + " bg-white text-zinc-700 ring-zinc-300 hover:bg-zinc-50 disabled:opacity-50"}
                >
                  {b.text}
                </button>
              );
            }
            return (
              <button
                key={bi}
                type="button"
                disabled
                title="Эта кнопка доступна только в Telegram-приложении"
                className={base + " cursor-not-allowed bg-zinc-100 text-zinc-400 ring-zinc-200"}
              >
                {b.text}
              </button>
            );
          })}
        </div>
      ))}
    </div>
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
      <ChatComposer
        value={props.text}
        onChange={props.onTextChange}
        onSend={props.onSend}
        sending={props.sending}
        placeholder={`Написать через ${props.accountLabel}…`}
        error={props.error}
      />
    </div>
  );
}

// MAX(lastInboundAt, lastOutboundAt) для одной записи chatAccounts.
// null если undefined (аккаунта нет в массиве) или у него нет ни одной даты.
function maxChatActivity(
  ca: Contact["chatAccounts"][number] | undefined,
): string | null {
  if (!ca) return null;
  if (ca.lastInboundAt && ca.lastOutboundAt) {
    return ca.lastInboundAt > ca.lastOutboundAt
      ? ca.lastInboundAt
      : ca.lastOutboundAt;
  }
  return ca.lastInboundAt ?? ca.lastOutboundAt ?? null;
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

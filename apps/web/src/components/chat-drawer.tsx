import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Hash,
  Mail,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  Smile,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import type { Contact, ChannelRelationStatus } from "@repo/core";
import { api, sendContactMedia } from "../lib/api";
import {
  RELATION_META,
  RELATION_CHOICES,
  RelationBadge,
} from "../lib/channel-relation";
import { copyText } from "../lib/clipboard";
import {
  dayKey,
  formatDateTime,
  formatDaySeparator,
  formatHHMM,
  formatPastRelative,
  formatRelative,
} from "../lib/date-utils";
import { errorMessage } from "../lib/errors";
import { formatFileSize } from "../lib/format";
import { useEscapeKey, useEventSourceEvent } from "../lib/hooks";
import { ChannelDrawer } from "./channel-drawer";
import { ChatComposer } from "./chat-composer";
import {
  accountHealth,
  accountHealthDotClass,
  type AccountHealth,
} from "../lib/account-health";
import { formatAccount } from "../lib/account-label";
import { Drawer } from "./drawer";
import { MaxChatBody } from "./max-chat-body";
import { NoteStrip } from "./note-strip";
import { StickerPicker } from "./sticker-picker";
import {
  chatFileUrl,
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
  // Здоровье аккаунта (ручка outreach/accounts уже отдаёт). Опциональны: не все
  // источники строят полный объект. Кулдаун НЕ блокирует ручную отправку —
  // только показываем менеджеру, чтобы решал сам (см. quick-send.ts).
  status?: string | null;
  cooldownUntil?: string | null;
  cooldownReason?: string | null;
};

// Ре-экспорт для существующих импортов из этого модуля; правило — в lib.
export { formatAccount };

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
  // Стикер — статичное превью (байты через chat-file по thumbFileId).
  sticker: { thumbFileId: number; emoji: string } | null;
  // Чисто текстовое (messageText) — гейт «Изменить».
  isPlainText: boolean;
  reactions: { emoji: string; count: number }[];
  replyMarkup: ReplyMarkup | null;
  // Ответ на сообщение этого же чата: id оригинала (текст ищем в подгруженной
  // ленте) + цитата-кусок, если отвечали на выделенный фрагмент.
  replyToId: string | null;
  replyQuote: string | null;
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
  // Лид-специфичная полоска под шапкой (статус + ссылка на карточку). Чат
  // контакто-скоупный, поэтому стадию рисует вызывающий (LeadChatDrawer).
  headerExtra?: ReactNode;
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
  // Полоска под шапкой (статус лида + ссылка на карточку); пусто вне канбана.
  headerExtra?: ReactNode;
}) {
  const qc = useQueryClient();
  const accountById = new Map(props.accounts.map((a) => [a.id, a]));
  const sendingAccount = accountById.get(props.accountId);

  const displayName = contactFullName(props.contact) || "—";
  const peerKey = props.contact.id;
  // Карточка канала рядом с перепиской (T3.1): чипы каналов админа в шапке,
  // клик открывает ChannelDrawer поверх чата — менеджер смотрит канал и
  // диалог, не уходя из переписки.
  // Один дравер канала поверх чата в двух режимах: просмотр карточки (клик по
  // чипу) и «Сменить контакт» — шорткат из шапки, когда админ сказал «пишите
  // туда» (open сразу в режиме смены, минуя карточку).
  const [channelView, setChannelView] = useState<{
    id: string;
    change: boolean;
  } | null>(null);

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
  // Кастом-эмодзи, вставленные в черновик из пикера: символ → custom_emoji_id.
  // Офсеты при редактировании текста не трекаем — перед отправкой находим
  // вхождения этих символов (по УЖЕ обрезанному тексту — он и уходит) и
  // вешаем entity на каждое. Допущение MVP: одинаковый символ в черновике =
  // один и тот же кастом-эмодзи.
  const draftEmojiRef = useRef(new Map<string, string>());
  const draftEntities = (text: string) => {
    const ents: { offset: number; length: number; customEmojiId: string }[] =
      [];
    const claimed: [number, number][] = [];
    // Длинные символы первыми: кастом-❤️ не должен забрать префикс у ❤️‍🔥.
    const items = [...draftEmojiRef.current]
      .filter(([emoji]) => emoji.length > 0)
      .sort((a, b) => b[0].length - a[0].length);
    for (const [emoji, id] of items) {
      for (
        let i = text.indexOf(emoji);
        i !== -1;
        i = text.indexOf(emoji, i + emoji.length)
      ) {
        const end = i + emoji.length;
        // Не режем ZWJ-последовательность (❤️ внутри набранного ❤️‍🔥) и не
        // плодим пересекающиеся entities — TDLib такие отвергает целиком.
        if (text.charCodeAt(end) === 0x200d) continue;
        if (claimed.some(([s, e]) => i < e && end > s)) continue;
        claimed.push([i, end]);
        ents.push({ offset: i, length: emoji.length, customEmojiId: id });
      }
    }
    ents.sort((a, b) => a.offset - b.offset);
    // Лимит Telegram — 100 кастом-эмодзи на сообщение; лишние уйдут юникодом.
    return ents.slice(0, 100);
  };
  // Контекстное меню сообщения (правый клик / «⋯») + reply-черновик композера.
  const [msgMenu, setMsgMenu] = useState<{
    m: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // Режим редактирования своего сообщения: текст оригинала уходит в композер,
  // prevDraft — недописанный черновик, вернём его после отправки/отмены.
  const [editTarget, setEditTarget] = useState<{
    id: string;
    original: string;
    prevDraft: string;
  } | null>(null);
  // Ошибки действий (загрузка файла, удаление, пометка) — одной красной
  // полосой под шапкой; каждая мутация чистит её на старте успеха.
  const [actionError, setActionError] = useState<string | null>(null);
  // Единая отправка через quick-send (отмена цепочек + cooldown-гейт на
  // бэке): черновик композера, текст бот-кнопки, стикер/кастом-эмодзи из
  // пикера. Параметры — аргументом, не из state: бот-кнопка шлёт свой text
  // без reply-черновика; clearDraft — стирать ли черновик после успеха
  // (true только когда отправляли его самого).
  const sendMut = useMutation({
    mutationFn: async (args: {
      text?: string;
      entities?: { offset: number; length: number; customEmojiId: string }[];
      sticker?: { remoteId: string };
      replyToMessageId?: string;
      clearDraft?: boolean;
    }) => {
      // text уходит как есть — офсеты entities посчитаны по нему; черновик
      // тримится в onSend ДО построения entities, тут не перетримливаем.
      if (!args.text?.trim() && !args.sticker) {
        throw new Error("Пустое сообщение");
      }
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/quick-send",
        {
          params: { path: { wsId: props.wsId } },
          body: {
            accountId: props.accountId,
            contactId: props.contact.id,
            text: args.text,
            entities: args.entities,
            sticker: args.sticker,
            replyToMessageId: args.replyToMessageId,
          },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: (_data, args) => {
      if (args.clearDraft) {
        setComposeText("");
        draftEmojiRef.current = new Map();
      }
      if (args.replyToMessageId) setReplyTo(null);
      qc.invalidateQueries({
        queryKey: ["chat-history", props.wsId, props.contact.id],
      });
      qc.invalidateQueries({
        queryKey: ["quick-send-preview", props.wsId, peerKey],
      });
    },
  });

  const editMut = useMutation({
    // prevDraft едет в args, а не читается из state: за время запроса режим
    // могли отменить или начать править другое сообщение.
    mutationFn: async (args: {
      messageId: string;
      text: string;
      prevDraft: string;
    }) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/chat/edit-message",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: {
            accountId: props.accountId,
            messageId: args.messageId,
            text: args.text,
          },
        },
      );
      if (error) throw error;
    },
    onSuccess: (_data, args) => {
      if (editTarget?.id === args.messageId) {
        setComposeText(args.prevDraft);
        setEditTarget(null);
      }
      // Сообщения старых страниц живут в локальном olderPages и инвалидацией
      // не перечитываются — патчим текст точечно, иначе правка «не видна».
      setOlderPages((prev) =>
        prev.map((m) =>
          m.id === args.messageId ? { ...m, text: args.text } : m,
        ),
      );
      qc.invalidateQueries({
        queryKey: ["chat-history", props.wsId, props.contact.id],
      });
    },
  });

  // Пометка «непрочитано» — chat-level (как в Telegram), тогл-конверт в
  // шапке. Бэк синкает с TG и пишет в contacts.
  const markUnreadMut = useMutation({
    mutationFn: async (value: boolean) => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-unread",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: { accountId: props.accountId, value },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({
        queryKey: ["contact", props.wsId, props.contact.id],
      });
    },
    onError: (e) => setActionError(errorMessage(e)),
  });

  // «Прочитать всё» — осознанное чтение: шлёт viewMessages (блогер увидит
  // «прочитано»), гасит счётчик и снимает ручную пометку. Антипод markUnreadMut.
  const markReadMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/chat/mark-read",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: { accountId: props.accountId },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({
        queryKey: ["contact", props.wsId, props.contact.id],
      });
    },
    onError: (e) => setActionError(errorMessage(e)),
  });

  const deleteMsgMut = useMutation({
    mutationFn: async (messageId: string) => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/contacts/{id}/chat/delete-messages",
        {
          params: { path: { wsId: props.wsId, id: props.contact.id } },
          body: { accountId: props.accountId, messageIds: [messageId] },
        },
      );
      if (error) throw error;
    },
    onSuccess: (_data, messageId) => {
      setActionError(null);
      // Удалили сообщение, на которое открыт reply-черновик — сбрасываем,
      // иначе отправка уйдёт с reply на несуществующий id.
      setReplyTo((prev) => (prev?.id === messageId ? null : prev));
      // То же с режимом правки: сохранение в удалённый id — мёртвый путь.
      if (editTarget?.id === messageId) {
        setComposeText(editTarget.prevDraft);
        setEditTarget(null);
        editMut.reset();
      }
      qc.invalidateQueries({
        queryKey: ["chat-history", props.wsId, props.contact.id],
      });
    },
    onError: (e) => setActionError(errorMessage(e)),
  });

  // Вложения композера: скрепка/drag-drop складывают файлы в стейджинг, менеджер
  // правит подпись и галочку «Отправить файлом», затем шлёт кнопкой отправки.
  // dragDepth — счётчик enter/leave (leave летит и от дочерних, булев флаг мигал
  // бы). asFile=false → картинки уходят сжатыми фото, прочее всегда документом.
  const [dragDepth, setDragDepth] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sendAsFile, setSendAsFile] = useState(false);
  const addFiles = (files: File[]) => {
    if (files.length) setPendingFiles((p) => [...p, ...files].slice(0, 10));
  };
  // Галочка «Отправить файлом» осмысленна только когда ВСЕ вложения — картинки
  // (выбор «сжать или оригинал»); в миксе не-картинки всё равно идут документом.
  const allImages =
    pendingFiles.length > 0 &&
    pendingFiles.every((f) => f.type.startsWith("image/"));
  const mediaMut = useMutation({
    mutationFn: (args: {
      files: File[];
      asFile: boolean;
      caption: string;
      replyToMessageId?: string;
    }) =>
      sendContactMedia(
        props.wsId,
        props.contact.id,
        props.accountId,
        args.files,
        args.asFile,
        args.caption,
        args.replyToMessageId,
      ),
    onSuccess: () => {
      setPendingFiles([]);
      setSendAsFile(false);
      setComposeText("");
      setReplyTo(null);
      qc.invalidateQueries({
        queryKey: [
          "chat-history",
          props.wsId,
          props.contact.id,
          props.accountId,
        ],
      });
    },
  });

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
        // И сам контакт: unread/markedUnread в шапке должны жить (пометку
        // могли поставить с телефона при открытом drawer'е).
        qc.invalidateQueries({
          queryKey: ["contact", props.wsId, props.contact.id],
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
    setReplyTo(null);
    setMsgMenu(null);
    setEditTarget(null);
    // draftEmojiRef НЕ чистим: черновик композера переживает смену аккаунта,
    // и вставленные в него кастом-эмодзи должны уйти кастомными.
    didAutoScrollRef.current = false;
  }, [props.accountId]);

  // Вложения сбрасываем при смене КОНТАКТА (а не аккаунта): иначе застейдженные
  // файлы могли бы уйти не тому собеседнику.
  useEffect(() => {
    setPendingFiles([]);
    setSendAsFile(false);
  }, [props.contact.id]);

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

  // Оригиналы для reply-цитат ищем в подгруженной ленте; клик по цитате и
  // jumpTo из фазы «Запуск» — один механизм (скролл + подсветка).
  const msgById = new Map(messages.map((mm) => [mm.id, mm]));
  const jumpToMessage = useCallback((id: string) => {
    const el = msgRefs.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightId(id);
    setTimeout(() => setHighlightId(null), 1800);
  }, []);

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
    jumpToMessage(jumpMessageId);
  }, [jumpNonce, jumpMessageId, jumpToMessage]);

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
        addFiles(Array.from(e.dataTransfer.files ?? []));
      }}
    >
        {dragDepth > 0 && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-emerald-50/90 text-sm font-medium text-emerald-700">
            Отпустите — прикрепить файлы
          </div>
        )}
        {actionError && (
          <div className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700">
            <span className="truncate">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="shrink-0 text-red-400 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}
        <ContactNote wsId={props.wsId} contact={props.contact} />
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
            {/* Две иконки рядом (не морфящаяся одна): открытый конверт —
                «прочитать всё», закрытый — «пометить непрочитанным». Активна
                всегда ровно одна (они антиподы), вторая приглушена. */}
            {(() => {
              const hasUnread =
                props.contact.unreadCount > 0 || props.contact.markedUnread;
              return (
                <>
                  <button
                    type="button"
                    disabled={markReadMut.isPending || !hasUnread}
                    onClick={() => markReadMut.mutate()}
                    title={
                      "Прочитать всё" +
                      (props.contact.unreadCount > 0
                        ? ` (${props.contact.unreadCount})`
                        : "") +
                      " — блогер увидит «прочитано»"
                    }
                    className={
                      "rounded p-1 disabled:opacity-40 " +
                      (hasUnread
                        ? "text-emerald-600 hover:bg-emerald-50"
                        : "text-zinc-400")
                    }
                  >
                    <MailOpen size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={markUnreadMut.isPending || hasUnread}
                    onClick={() => markUnreadMut.mutate(true)}
                    title="Пометить непрочитанным («вернуться позже») — видно и в Telegram"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40"
                  >
                    <Mail size={16} />
                  </button>
                </>
              );
            })()}
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
        {props.headerExtra}
        <ChannelRelationList
          wsId={props.wsId}
          contact={props.contact}
          onOpenCard={(id, change) => setChannelView({ id, change })}
        />
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
              const health = accountHealth(acc);
              return (
                <button
                  type="button"
                  key={ca.accountId}
                  onClick={() => props.onSelectAccount(ca.accountId)}
                  title={health.detail ?? undefined}
                  className={
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium " +
                    (active
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200")
                  }
                >
                  {health.kind !== "ok" && (
                    <span
                      className={
                        "h-1.5 w-1.5 rounded-full " +
                        accountHealthDotClass(health.kind)
                      }
                    />
                  )}
                  {acc ? formatAccount(acc) : ca.accountId}
                </button>
              );
            })}
          </div>
        )}
        {/* overflow-x-hidden — продуктовое требование: горизонтального
            скролла в ленте не бывает ни при каком контенте; неразрывные
            строки клампятся (текст и цитаты переносим через break-words). */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto overflow-x-hidden bg-zinc-50 p-4"
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
                  {messages.map((m, i) => {
                    const readByPeer =
                      m.isOutgoing && isIdAtMost(m.id, lastReadOutboxId);
                    // Разделитель суток: перед первым сообщением и на стыке дней.
                    const prev = i > 0 ? messages[i - 1] : null;
                    const showDay =
                      !prev || dayKey(prev.date) !== dayKey(m.date);
                    return (
                      <Fragment key={m.id}>
                        {showDay && (
                          <div className="my-1 flex justify-center">
                            <span className="rounded-full bg-zinc-200/80 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600">
                              {formatDaySeparator(m.date)}
                            </span>
                          </div>
                        )}
                      <div
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
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setMsgMenu({ m, x: e.clientX, y: e.clientY });
                          }}
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
                          {m.sticker ? (
                            <img
                              src={chatFileUrl({
                                wsId: props.wsId,
                                contactId: props.contact.id,
                                accountId: props.accountId,
                                fileId: m.sticker.thumbFileId,
                                name: "sticker.webp",
                                mime: "image/webp",
                              })}
                              alt={m.sticker.emoji || "стикер"}
                              title={m.sticker.emoji}
                              loading="lazy"
                              className="h-28 w-28 object-contain p-1"
                            />
                          ) : m.media ? (
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
                            {(m.replyToId || m.replyQuote) && (
                              <ReplyQuote
                                original={
                                  m.replyToId
                                    ? (msgById.get(m.replyToId) ?? null)
                                    : null
                                }
                                quote={m.replyQuote}
                                peerName={displayName}
                                inOutgoing={m.isOutgoing}
                                onJump={() =>
                                  m.replyToId && jumpToMessage(m.replyToId)
                                }
                              />
                            )}
                            {m.document && (
                              <a
                                href={chatFileUrl({
                                  wsId: props.wsId,
                                  contactId: props.contact.id,
                                  accountId: props.accountId,
                                  fileId: m.document.fileId,
                                  name: m.document.fileName,
                                  mime: m.document.mimeType,
                                })}
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
                            onSendText={(t) => sendMut.mutate({ text: t })}
                            disabled={sendMut.isPending}
                          />
                        )}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              const r =
                                e.currentTarget.getBoundingClientRect();
                              setMsgMenu({ m, x: r.left, y: r.bottom + 4 });
                            }}
                            title="Действия с сообщением"
                            className="rounded px-1 py-0.5 text-zinc-400 opacity-0 transition-opacity hover:text-zinc-700 group-hover:opacity-100"
                          >
                            <MoreHorizontal size={13} />
                          </button>
                          {props.onTagMessage && (
                            <>
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
                            </>
                          )}
                        </div>
                      </div>
                      </Fragment>
                    );
                  })}
                </div>
              )}
          </>
        </div>
        <ComposeFooter
          wsId={props.wsId}
          contactId={props.contact.id}
          accountId={props.accountId}
          onSendSticker={(remoteId) =>
            sendMut.mutate({
              sticker: { remoteId },
              replyToMessageId: replyTo?.id,
            })
          }
          onPickCustomEmoji={(id, emoji) => {
            setComposeText((t) => t + emoji);
            draftEmojiRef.current.set(emoji, id);
          }}
          activeProjects={previewQ.data ?? []}
          accountLabel={
            sendingAccount ? formatAccount(sendingAccount) : props.accountId
          }
          health={accountHealth(sendingAccount)}
          text={composeText}
          onTextChange={setComposeText}
          onSend={() => {
            const text = composeText.trim();
            if (editTarget) {
              if (text) {
                editMut.mutate({
                  messageId: editTarget.id,
                  text,
                  prevDraft: editTarget.prevDraft,
                });
              }
              return;
            }
            // Есть вложения — уходят медиа-роутом (подпись = текст черновика).
            // asFile учитываем только когда всё картинки (в миксе галочки нет).
            if (pendingFiles.length) {
              mediaMut.mutate({
                files: pendingFiles,
                asFile: allImages && sendAsFile,
                caption: text,
                replyToMessageId: replyTo?.id,
              });
              return;
            }
            sendMut.mutate({
              text,
              entities: draftEntities(text),
              replyToMessageId: replyTo?.id,
              clearDraft: true,
            });
          }}
          sending={
            sendMut.isPending || editMut.isPending || mediaMut.isPending
          }
          pendingFiles={pendingFiles}
          allImages={allImages}
          onAddFiles={addFiles}
          onRemoveFile={(i) =>
            setPendingFiles((p) => p.filter((_, idx) => idx !== i))
          }
          sendAsFile={sendAsFile}
          onToggleAsFile={setSendAsFile}
          // Ошибка активного режима (правка / вложения / текст) — не смешиваем,
          // чтобы старая ошибка одного не маскировала другой.
          error={(() => {
            const m = editTarget
              ? editMut
              : pendingFiles.length
                ? mediaMut
                : sendMut;
            return m.error ? errorMessage(m.error) : null;
          })()}
          editTo={editTarget ? { text: editTarget.original } : null}
          onCancelEdit={() => {
            setComposeText(editTarget?.prevDraft ?? "");
            setEditTarget(null);
            editMut.reset();
          }}
          replyTo={
            replyTo
              ? {
                  label: replyTo.isOutgoing ? "Вы" : displayName,
                  text: replyTo.text || "медиа",
                }
              : null
          }
          onCancelReply={() => setReplyTo(null)}
        />
        {channelView && (
          <ChannelDrawer
            wsId={props.wsId}
            channelId={channelView.id}
            contactChange={channelView.change}
            onResolved={
              channelView.change
                ? () => {
                    // Контакт канала сменился — освежаем чипы каналов контакта.
                    qc.invalidateQueries({
                      queryKey: ["contact", props.wsId, props.contact.id],
                    });
                    qc.invalidateQueries({ queryKey: ["contacts"] });
                  }
                : undefined
            }
            onClose={() => setChannelView(null)}
          />
        )}
        {msgMenu && (
          <MessageContextMenu
            x={msgMenu.x}
            y={msgMenu.y}
            canCopy={!!msgMenu.m.text}
            // Только свои чисто текстовые без форматирования (правка шлёт
            // plain text — ссылки/жирный стёрлись бы) и моложе 48ч (лимит
            // правки Telegram — иначе пункт-ловушка: набрал → ошибка).
            canEdit={
              msgMenu.m.isOutgoing &&
              msgMenu.m.isPlainText &&
              msgMenu.m.entities.length === 0 &&
              Date.now() - new Date(msgMenu.m.date).getTime() <
                48 * 3600_000
            }
            canDelete={msgMenu.m.isOutgoing}
            onClose={() => setMsgMenu(null)}
            onReply={() => {
              setReplyTo(msgMenu.m);
              // Reply и edit взаимоисключающие в обе стороны — иначе reply
              // живёт невидимым под edit-плашкой и всплывает позже.
              if (editTarget) {
                setComposeText(editTarget.prevDraft);
                setEditTarget(null);
                editMut.reset();
              }
              setMsgMenu(null);
            }}
            onCopy={() => {
              void copyText(msgMenu.m.text);
              setMsgMenu(null);
            }}
            onEdit={() => {
              const m = msgMenu.m;
              setMsgMenu(null);
              editMut.reset();
              setEditTarget({
                id: m.id,
                original: m.text,
                prevDraft: composeText,
              });
              setComposeText(m.text);
              setReplyTo(null);
            }}
            onDelete={() => {
              const id = msgMenu.m.id;
              setMsgMenu(null);
              if (
                window.confirm(
                  "Удалить сообщение у обоих? В Telegram у собеседника оно тоже исчезнет.",
                )
              ) {
                deleteMsgMut.mutate(id);
              }
            }}
          />
        )}
    </div>
  );
}

// Цитата в пузыре: на что отвечает сообщение. Оригинал ищем в подгруженной
// ленте — клик скроллит к нему; если оригинал за окном подгрузки, показываем
// replyQuote (выделенный кусок) или generic-подпись без клика.
function ReplyQuote(props: {
  original: ChatMessage | null;
  quote: string | null;
  peerName: string;
  inOutgoing: boolean;
  onJump: () => void;
}) {
  const snippet =
    props.quote ||
    props.original?.text ||
    (props.original ? "медиа" : "сообщение выше");
  const author = props.original
    ? props.original.isOutgoing
      ? "Вы"
      : props.peerName
    : null;
  const cls = props.inOutgoing
    ? "border-emerald-200 bg-emerald-700/40 text-emerald-50"
    : "border-emerald-500 bg-zinc-100 text-zinc-700";
  const inner = (
    <>
      {author && (
        <span
          className={
            "block text-[10px] font-medium " +
            (props.inOutgoing ? "text-emerald-100" : "text-emerald-700")
          }
        >
          {author}
        </span>
      )}
      <span className="block max-h-8 overflow-hidden break-words text-xs leading-4">
        {snippet}
      </span>
    </>
  );
  if (!props.original) {
    return <div className={`mb-1 rounded border-l-2 px-2 py-1 ${cls}`}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={props.onJump}
      className={`mb-1 block w-full rounded border-l-2 px-2 py-1 text-left hover:opacity-80 ${cls}`}
    >
      {inner}
    </button>
  );
}

// Контекстное меню сообщения. Два входа — правый клик по пузырю и «⋯» под
// ним, оба открывают это. Оверлей ловит клик/правый клик мимо; Esc — через
// общий стек (закрывает меню, не drawer). Сюда же позже въедут реакции.
// «Пометить непрочитанным» здесь нет осознанно: в Telegram это флаг диалога,
// не сообщения — тогл-конверт в шапке чата.
function MessageContextMenu(props: {
  x: number;
  y: number;
  canCopy: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useEscapeKey(props.onClose);
  const itemCls =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50";
  // Не выезжаем за низ/право окна (меню ≈ 4 пункта × ~34px).
  const top = Math.min(props.y, window.innerHeight - 160);
  const left = Math.min(props.x, window.innerWidth - 240);
  return (
    <div
      className="fixed inset-0 z-50"
      onClick={props.onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div
        style={{ top, left }}
        className="absolute w-56 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={props.onReply} className={itemCls}>
          <Reply size={14} className="text-zinc-400" /> Ответить
        </button>
        {props.canCopy && (
          <button type="button" onClick={props.onCopy} className={itemCls}>
            <Copy size={14} className="text-zinc-400" /> Копировать текст
          </button>
        )}
        {props.canEdit && (
          <button type="button" onClick={props.onEdit} className={itemCls}>
            <Pencil size={14} className="text-zinc-400" /> Изменить
          </button>
        )}
        {props.canDelete && (
          <button
            type="button"
            onClick={props.onDelete}
            className={itemCls + " text-red-600"}
          >
            <Trash2 size={14} /> Удалить у обоих
          </button>
        )}
      </div>
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

// Пометка об админе (T3.2): contact.note — то же поле, что
// редактирует карточка контакта. Менеджеру в переписке важно видеть заметки
// коллег («не беспокоить до января») не уходя из чата; пометка о канале — в
// один клик через чип канала в шапке (карточка канала). Янтарный фон — чтобы
// бросалась в глаза (просьба Юли, тест 10.06.26). Используется также в
// LeadPrepPane (драфт-инбокс) — увидеть «заебали» ДО запуска рассылки.
// Пометка об админе (T3.2): contact.note — то же поле, что в карточке
// контакта и в инбоксе подготовки (LeadPrepPane). Менеджеру в переписке важно
// видеть заметки коллег («не беспокоить до января») не уходя из чата; пометка
// о канале — в один клик через чип канала в шапке (карточка канала).
// Одна строка вертикального списка каналов админа в сайдбаре: канал + текущий
// статус взаимодействия + правка статуса (дропдаун + причина) + лента истории
// решений. Статус append-only: сохранение добавляет запись в relationHistory.
function ChannelRelationRow(props: {
  wsId: string;
  contactId: string;
  channel: Contact["channels"][number];
  onOpenCard: (id: string, change: boolean) => void;
}) {
  const ch = props.channel;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // Для канала без статуса предлагаем "working" как дефолт черновика, но
  // baseStatus отдельно от ch.relationStatus: dirty считаем относительно
  // фактического снимка, чтобы у «none»-канала кнопка сразу была доступна.
  const baseStatus: ChannelRelationStatus =
    ch.relationStatus === "none" ? "working" : ch.relationStatus;
  const [status, setStatus] = useState<ChannelRelationStatus>(baseStatus);
  const [note, setNote] = useState("");
  // Запись append-only: «есть что сохранить» = сменили статус относительно
  // текущего снимка ИЛИ ввели комментарий. Иначе кнопку «Сохранить» прячем
  // (CLAUDE.md: показывать только при наличии unsaved-изменений).
  const dirty = status !== ch.relationStatus || note.trim() !== "";
  const openEditor = () => {
    setStatus(baseStatus);
    setNote("");
    setEditing(true);
  };
  const closeEditor = () => {
    setStatus(baseStatus);
    setNote("");
    setEditing(false);
  };

  const mut = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/relation",
        {
          params: { path: { wsId: props.wsId, id: ch.id } },
          body: { status, note: note.trim() || null },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      // status уже равен сохранённому; после рефетча ch.relationStatus
      // совпадёт с ним → dirty=false. note сбрасываем.
      setEditing(false);
      setNote("");
      qc.invalidateQueries({
        queryKey: ["contact", props.wsId, props.contactId],
      });
      qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
      // Бейдж статуса на карточках доски (prefix-match по всем проектам).
      qc.invalidateQueries({ queryKey: ["project-leads"] });
    },
  });

  return (
    <div className="rounded-md border border-zinc-200 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => props.onOpenCard(ch.id, false)}
          title="Открыть карточку канала"
          className="flex min-w-0 flex-1 items-center gap-1 text-[12px] font-medium text-zinc-700 hover:text-emerald-700"
        >
          <Hash size={12} className="shrink-0 text-zinc-400" />
          <span className="truncate">{ch.title}</span>
          {ch.username && (
            <span className="shrink-0 text-[11px] font-normal text-zinc-400">
              @{ch.username}
            </span>
          )}
        </button>
        <RelationBadge status={ch.relationStatus} />
        <button
          type="button"
          onClick={() => (editing ? closeEditor() : openEditor())}
          title="Изменить статус"
          className="shrink-0 text-zinc-400 hover:text-zinc-700"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => props.onOpenCard(ch.id, true)}
          title="Сменить контакт по этому каналу"
          className="shrink-0 text-zinc-400 hover:text-emerald-700"
        >
          <ArrowLeftRight size={12} />
        </button>
      </div>

      {editing && (
        <div className="mt-2 flex flex-col gap-1.5">
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as ChannelRelationStatus)
            }
            className="rounded border border-zinc-300 px-1.5 py-1 text-[12px]"
          >
            {RELATION_CHOICES.map((s) => (
              <option key={s} value={s}>
                {RELATION_META[s].label}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Причина / комментарий (необязательно)"
            rows={2}
            className="rounded border border-zinc-300 px-1.5 py-1 text-[12px]"
          />
          <div className="flex items-center gap-2">
            {dirty && (
              <button
                type="button"
                disabled={mut.isPending}
                onClick={() => mut.mutate()}
                className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Сохранить
              </button>
            )}
            <button
              type="button"
              onClick={closeEditor}
              className="text-[11px] text-zinc-500 hover:text-zinc-800"
            >
              Отмена
            </button>
            {mut.isError && (
              <span className="text-[11px] text-red-600">Ошибка</span>
            )}
          </div>
        </div>
      )}

      {ch.relationHistory.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-700"
          >
            {showHistory ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            История ({ch.relationHistory.length})
          </button>
          {showHistory && (
            <ul className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-2">
              {ch.relationHistory.slice().reverse().map((h) => (
                <li key={h.at} className="text-[11px] leading-snug text-zinc-600">
                  <RelationBadge status={h.status} />{" "}
                  {h.note && <span>— {h.note} </span>}
                  <span className="text-zinc-400">
                    · {h.byName ?? "—"}, {formatPastRelative(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Вертикальный список каналов админа со статусом взаимодействия по каждому.
// Заменил горизонтальные чипы (T3.1): теперь решение по каналу видно и
// правится прямо в сайдбаре, а заметка-памятка свернулась в историю.
export function ChannelRelationList(props: {
  wsId: string;
  contact: Contact;
  onOpenCard: (id: string, change: boolean) => void;
}) {
  if (props.contact.channels.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-b border-zinc-200 px-3 py-2">
      {props.contact.channels.map((ch) => (
        <ChannelRelationRow
          key={ch.id}
          wsId={props.wsId}
          contactId={props.contact.id}
          channel={ch}
          onOpenCard={props.onOpenCard}
        />
      ))}
    </div>
  );
}

export function ContactNote(props: { wsId: string; contact: Contact }) {
  const qc = useQueryClient();
  return (
    <NoteStrip
      note={props.contact.note}
      addLabel="пометка об админе"
      placeholder="Например: не беспокоить до января"
      title="Пометка об админе — видна коллегам во всех его каналах. Нажмите, чтобы изменить."
      onSave={async (text) => {
        const { error } = await api.PATCH(
          "/v1/workspaces/{wsId}/contacts/{id}/note",
          {
            params: { path: { wsId: props.wsId, id: props.contact.id } },
            body: { note: text || null },
          },
        );
        if (error) throw error;
        qc.invalidateQueries({
          queryKey: ["contact", props.wsId, props.contact.id],
        });
        qc.invalidateQueries({ queryKey: ["contacts", props.wsId] });
      }}
    />
  );
}

// Превью одного вложения в стейджинге: картинки — миниатюрой (object URL,
// чистим при размонтировании), прочее — иконкой с именем. × убирает из набора.
function AttachmentChip(props: { file: File; onRemove: () => void }) {
  const isImg = props.file.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImg) return;
    const u = URL.createObjectURL(props.file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [props.file, isImg]);
  return (
    <div className="relative">
      {isImg && url ? (
        <img
          src={url}
          alt={props.file.name}
          className="h-16 w-16 rounded object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded bg-white px-1 text-center">
          <FileText size={20} className="text-zinc-400" />
          <span className="w-full truncate text-[10px] text-zinc-500">
            {props.file.name}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={props.onRemove}
        title="Убрать"
        className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-zinc-700 text-white hover:bg-zinc-900"
      >
        <X size={10} />
      </button>
    </div>
  );
}

function ComposeFooter(props: {
  wsId: string;
  contactId: string;
  accountId: string;
  activeProjects: { id: string; name: string }[];
  accountLabel: string;
  // Состояние аккаунта-отправителя: показываем баннер над полем (не блокируем).
  health: AccountHealth;
  text: string;
  onTextChange: (v: string) => void;
  onSend: () => void;
  // Стикер из пикера отправляется сразу, минуя поле; кастом-эмодзи
  // вставляется в черновик (его юникод-фолбэк), entity вешается при отправке.
  onSendSticker: (remoteId: string) => void;
  onPickCustomEmoji: (id: string, emoji: string) => void;
  sending: boolean;
  error: string | null;
  // Reply-черновик: плашка «в ответ на …» над полем; null — обычная отправка.
  replyTo: { label: string; text: string } | null;
  onCancelReply: () => void;
  // Режим редактирования сообщения: плашка с оригиналом, Enter сохраняет.
  // Взаимоисключим с reply (вход в edit сбрасывает reply-черновик).
  editTo: { text: string } | null;
  onCancelEdit: () => void;
  // Вложения в стейджинге: скрепка/drag-drop складывают сюда, плашка показывает
  // превью + чекбокс «Отправить файлом», отправка — общей кнопкой. allImages —
  // все ли вложения картинки (от этого зависит видимость чекбокса).
  pendingFiles: File[];
  allImages: boolean;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  sendAsFile: boolean;
  onToggleAsFile: (v: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="border-t border-zinc-200 bg-white p-3">
      {props.editTo && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-amber-500 bg-amber-50 px-2.5 py-1.5 text-xs">
          <Pencil size={14} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-amber-700">
              Редактирование сообщения
            </div>
            <div className="truncate text-zinc-600">{props.editTo.text}</div>
          </div>
          <button
            type="button"
            onClick={props.onCancelEdit}
            title="Отменить редактирование"
            className="shrink-0 text-zinc-400 hover:text-zinc-700"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!props.editTo && props.replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-emerald-500 bg-zinc-50 px-2.5 py-1.5 text-xs">
          <Reply size={14} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-emerald-700">
              {props.replyTo.label}
            </div>
            <div className="truncate text-zinc-600">{props.replyTo.text}</div>
          </div>
          <button
            type="button"
            onClick={props.onCancelReply}
            title="Отменить ответ"
            className="shrink-0 text-zinc-400 hover:text-zinc-700"
          >
            <X size={14} />
          </button>
        </div>
      )}
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
      {props.pendingFiles.length > 0 && (
        <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
          <div className="flex flex-wrap gap-2">
            {props.pendingFiles.map((f, i) => (
              <AttachmentChip
                key={`${f.name}-${f.size}-${i}`}
                file={f}
                onRemove={() => props.onRemoveFile(i)}
              />
            ))}
          </div>
          {/* В миксе не-картинки всё равно уходят документом — выбора нет,
              прячем (см. allImages в ChatPanel). */}
          {props.allImages && (
            <label className="mt-2 flex w-fit items-center gap-1.5 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={props.sendAsFile}
                onChange={(e) => props.onToggleAsFile(e.target.checked)}
              />
              Отправить файлом (без сжатия картинок)
            </label>
          )}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          props.onAddFiles(Array.from(e.target.files ?? []));
          // сброс — иначе повторный выбор того же файла не триггерит change.
          e.target.value = "";
        }}
      />
      <div className="relative">
        {pickerOpen && (
          <StickerPicker
            // remount на смену аккаунта: наборы другие, и внутренний стейт
            // (вкладка + строка поиска) должен сброситься.
            key={props.accountId}
            wsId={props.wsId}
            contactId={props.contactId}
            accountId={props.accountId}
            onClose={() => setPickerOpen(false)}
            onUnicode={(e) => props.onTextChange(props.text + e)}
            onSticker={(remoteId) => {
              props.onSendSticker(remoteId);
              setPickerOpen(false);
            }}
            onCustomEmoji={props.onPickCustomEmoji}
          />
        )}
        {props.health.kind !== "ok" && (
          <div
            className={
              "mb-2 rounded-md px-2.5 py-1.5 text-xs " +
              (props.health.kind === "banned"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-800")
            }
          >
            {props.health.detail}
            {props.health.kind === "cooldown" &&
              " · отправить можно — TG ограничивает только письма новым контактам"}
          </div>
        )}
        <ChatComposer
          value={props.text}
          onChange={props.onTextChange}
          onSend={props.onSend}
          sending={props.sending}
          formatting
          canSendEmpty={props.pendingFiles.length > 0}
          placeholder={`Написать через ${props.accountLabel}…`}
          error={props.error}
          tools={
            <>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Прикрепить файлы"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <Paperclip size={16} />
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                title="Эмодзи и стикеры"
                className={
                  "inline-flex h-6 w-6 items-center justify-center rounded " +
                  (pickerOpen
                    ? "bg-zinc-100 text-emerald-600"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700")
                }
              >
                <Smile size={16} />
              </button>
            </>
          }
        />
      </div>
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

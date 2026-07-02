import { z } from "@hono/zod-openapi";
import {
  type TdContent,
  TdDocumentSchema,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
  TdStickerSchema,
  MessageReactionSchema,
  extractCreativeMedia,
  extractDocument,
  extractFormattedText,
  extractMediaThumb,
  extractReactions,
  extractSticker,
} from "./td-message.ts";

// Сериализация TDLib-сообщения в форму ленты чата. Общий источник для authed
// chat-history (routes/contacts.ts) и публичной read-only переписки
// (routes/conversation-share-client.ts) — держим здесь, в lib, а не в route,
// чтобы публичный роутер не тянул весь authed-модуль contacts в свой граф.

// Кнопки бота (этап 16.9). Нормализуем TDLib reply_markup в плоскую модель,
// которую фронт рендерит без знания TDLib-типов:
//   - url        → ссылка (inlineKeyboardButtonTypeUrl);
//   - send_text  → нажатие отправляет text кнопки (replyMarkupShowKeyboard);
//   - unsupported→ показываем серой, нажать нельзя (callback/webapp/оплата/…
//     не делаем в MVP, см. AskUserQuestion «Только reply-клавиатура»).
const ReplyButtonSchema = z.object({
  text: z.string(),
  action: z.enum(["url", "send_text", "unsupported"]),
  url: z.string().optional(),
});
const ReplyMarkupSchema = z.object({
  kind: z.enum(["inline", "keyboard"]),
  rows: z.array(z.array(ReplyButtonSchema)),
});

export const ChatMessageSchema = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  isOutgoing: z.boolean(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
  // full-res дескриптор фото/видео-постера (байты — через chat-media роут по id).
  media: z
    .object({
      kind: z.enum(["photo", "video"]),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable(),
  document: TdDocumentSchema.nullable(),
  // Стикер — статичное превью (байты — chat-file роут по thumbFileId).
  sticker: TdStickerSchema.nullable(),
  // Чисто текстовое (messageText) — гейт «Изменить»: у voice/poll/гео и
  // прочих text — наша заглушка «[голосовое]», править нечего.
  isPlainText: z.boolean(),
  reactions: z.array(MessageReactionSchema),
  replyMarkup: ReplyMarkupSchema.nullable(),
  // Сообщение — ответ на другое (messageReplyToMessage). Текст оригинала фронт
  // берёт из своей подгруженной ленты по id; replyQuote — выделенная цитата,
  // если отвечали на кусок текста (фолбэк, когда оригинала нет в окне).
  replyToId: z.string().nullable(),
  replyQuote: z.string().nullable(),
  // id альбома (media_album_id), если сообщение — часть альбома; иначе null.
  // Фронт группирует по нему при пометке сообщения (фаза «Запуск»).
  albumId: z.string().nullable(),
});

type TdInlineButton = {
  text: string;
  type: { _: string; url?: string };
};
type TdKeyboardButton = { text: string; type: { _: string } };
type TdReplyMarkup = {
  _: string;
  rows?: (TdInlineButton[] | TdKeyboardButton[])[];
};
export type TdMessage = {
  id: number | string;
  date: number;
  is_outgoing: boolean;
  content: TdContent;
  // По td_api.tl (messageReplyToMessage): origin/content заполнены только
  // для ответа на сообщение ИЗ ДРУГОГО чата («ответить в другом чате» — ей
  // пользуются и в личках, цитируя пост канала); для same-chat оба null.
  reply_to?: {
    _: string;
    message_id?: number | string;
    quote?: { text?: { text?: string } };
    origin?: unknown;
    content?: TdContent;
  };
  reply_markup?: TdReplyMarkup;
  media_album_id?: number | string;
  interaction_info?: {
    reactions?: {
      reactions?: { type: { _: string; emoji?: string }; total_count: number }[];
    };
  };
};

// TDLib reply_markup → нормализованная модель (см. ReplyMarkupSchema).
function mapReplyMarkup(
  rm: TdReplyMarkup | undefined,
): z.infer<typeof ReplyMarkupSchema> | null {
  if (!rm) return null;
  if (rm._ === "replyMarkupInlineKeyboard") {
    const rows = (rm.rows ?? []).map((row) =>
      (row as TdInlineButton[]).map((b) =>
        b.type._ === "inlineKeyboardButtonTypeUrl" && b.type.url
          ? { text: b.text, action: "url" as const, url: b.type.url }
          : { text: b.text, action: "unsupported" as const },
      ),
    );
    return { kind: "inline", rows };
  }
  if (rm._ === "replyMarkupShowKeyboard") {
    const rows = (rm.rows ?? []).map((row) =>
      (row as TdKeyboardButton[]).map((b) =>
        // Обычная текст-кнопка → нажатие шлёт её текст. Спец-кнопки (запрос
        // контакта/локации/webapp) — серым, в MVP не обрабатываем.
        b.type._ === "keyboardButtonTypeText"
          ? { text: b.text, action: "send_text" as const }
          : { text: b.text, action: "unsupported" as const },
      ),
    );
    return { kind: "keyboard", rows };
  }
  // replyMarkupRemoveKeyboard / replyMarkupForceReply — рендерить нечего.
  return null;
}

export function mapMessage(m: TdMessage): z.infer<typeof ChatMessageSchema> {
  const { text, entities } = extractFormattedText(m.content);
  const reply = m.reply_to?._ === "messageReplyToMessage" ? m.reply_to : null;
  const mediaThumb = extractMediaThumb(m.content);
  const document = extractDocument(m.content);
  const sticker = extractSticker(m.content);
  const cm = extractCreativeMedia(m.content);
  const media = cm
    ? { kind: cm.kind, width: cm.width, height: cm.height }
    : null;
  return {
    id: String(m.id),
    date: new Date(m.date * 1000).toISOString(),
    isOutgoing: m.is_outgoing,
    // Voice/audio/location/poll/… — без текста и без thumb; короткий
    // type-label, чтобы пузырь не был пустым. Документ и стикер с превью
    // рендерятся сами → fallback не нужен.
    text:
      text || (mediaThumb || document || sticker ? "" : fallbackLabel(m.content)),
    entities,
    mediaThumb,
    media,
    document,
    sticker,
    isPlainText: m.content._ === "messageText",
    reactions: extractReactions(m.interaction_info),
    replyMarkup: mapReplyMarkup(m.reply_markup),
    // Ответ «из другого чата» (origin != null) нашей ленте не атрибутируем —
    // message_id там из id-пространства чужого чата, по нему легко найти не
    // то сообщение. Отдаём только текст (цитата или контент оригинала),
    // фронт нарисует некликабельную цитату.
    replyToId:
      reply && !reply.origin && reply.message_id
        ? String(reply.message_id)
        : null,
    replyQuote:
      reply?.quote?.text?.text ||
      (reply?.origin && reply.content
        ? extractFormattedText(reply.content).text
        : "") ||
      null,
    albumId:
      m.media_album_id && String(m.media_album_id) !== "0"
        ? String(m.media_album_id)
        : null,
  };
}

function fallbackLabel(content: TdContent): string {
  switch (content._) {
    // Одиночное эмодзи (в т.ч. кастомное) без статичного превью — сам символ.
    case "messageAnimatedEmoji":
      return content.emoji ?? "";
    case "messageVoiceNote":
      return "[голосовое]";
    case "messageVideoNote":
      return "[видеосообщение]";
    case "messageSticker":
      return "[стикер]";
    case "messageAudio":
      return "[аудио]";
    case "messageDocument":
      return "[файл]";
    case "messageLocation":
      return "[геопозиция]";
    case "messageContact":
      return "[контакт]";
    case "messagePoll":
      return "[опрос]";
    default:
      return `[${content._.replace(/^message/, "")}]`;
  }
}

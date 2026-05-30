import { z } from "@hono/zod-openapi";

// Общая обработка TDLib message-content для /channels/history и
// /contacts/chat-history: формат-текст с entities + minithumbnail. Оба
// endpoint'а сериализуют по одному и тому же контракту, фронт рендерит
// через apps/web/src/lib/tg-message.tsx.

// Подмножество textEntityType, которое умеем рендерить без сторонних
// данных (резолва user_id / загрузки кастомных эмодзи) и без UX-механик
// (spoiler/expandable). См. td_api.tl §textEntityType*.
export const TdEntityKindSchema = z.enum([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
  "pre",
  "preCode",
  "blockquote",
  "url",
  "textUrl",
  "email",
  "phone",
  "mention",
  "hashtag",
  "cashtag",
]);

export const TdMessageEntitySchema = z.object({
  // UTF-16 code units, как в JS-строке.
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  kind: TdEntityKindSchema,
  url: z.string().optional(),
  language: z.string().optional(),
});

// Inline-thumbnail из messagePhoto/Video/Animation: jpeg ~250B base64,
// идёт в payload'е без отдельного downloadFile. Width/height — реальные
// dimensions thumbnail'а, юзаются для aspect-ratio.
export const TdMediaThumbSchema = z.object({
  kind: z.enum(["photo", "video", "animation"]),
  b64: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// Документ (messageDocument): отдаём метаданные, чтобы чат отрисовал пузырь с
// именем/размером и кнопкой скачать (download-эндпоинт тянет байты по fileId).
export const TdDocumentSchema = z.object({
  fileId: z.number().int(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int(),
});

export type MappedEntity = z.infer<typeof TdMessageEntitySchema>;
export type MappedThumb = z.infer<typeof TdMediaThumbSchema>;
export type MappedDocument = z.infer<typeof TdDocumentSchema>;

const ENTITY_KIND_BY_TD: Record<string, MappedEntity["kind"] | undefined> = {
  textEntityTypeBold: "bold",
  textEntityTypeItalic: "italic",
  textEntityTypeUnderline: "underline",
  textEntityTypeStrikethrough: "strikethrough",
  textEntityTypeCode: "code",
  textEntityTypePre: "pre",
  textEntityTypePreCode: "preCode",
  textEntityTypeBlockQuote: "blockquote",
  textEntityTypeUrl: "url",
  textEntityTypeTextUrl: "textUrl",
  textEntityTypeEmailAddress: "email",
  textEntityTypePhoneNumber: "phone",
  textEntityTypeMention: "mention",
  textEntityTypeHashtag: "hashtag",
  textEntityTypeCashtag: "cashtag",
};

type TdEntity = {
  offset: number;
  length: number;
  type: { _: string; url?: string; language?: string };
};
export type TdFormattedText = { text: string; entities?: TdEntity[] };
type TdMinithumb = { width: number; height: number; data: string };
type TdMedia = { minithumbnail?: TdMinithumb };
type TdPhotoSize = {
  type: string; // s≈100 m≈320 x≈800 y≈1280 w≈2560 (бокс по Telegram)
  photo: { id: number };
  width: number;
  height: number;
};
type TdPhoto = TdMedia & { sizes?: TdPhotoSize[] };
type TdVideo = TdMedia & {
  thumbnail?: { file?: { id: number } };
  width?: number;
  height?: number;
};
type TdDocument = {
  file_name?: string;
  mime_type?: string;
  document?: { id?: number; size?: number };
};
export type TdContent = {
  _: string;
  text?: TdFormattedText;
  caption?: TdFormattedText;
  photo?: TdPhoto;
  video?: TdVideo;
  animation?: TdMedia;
  document?: TdDocument;
};

// Реакции сообщения (эмодзи + счётчик) — общий разбор для ленты канала и
// личного чата (структура interaction_info в TDLib одинаковая). Только обычные
// emoji: custom-emoji без скачивания не отрисуем, paid-реакции скипаем.
export const MessageReactionSchema = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
});
type TdInteractionInfo = {
  view_count?: number;
  forward_count?: number;
  reactions?: {
    reactions?: { type?: { _: string; emoji?: string }; total_count?: number }[];
  };
};
export function extractReactions(
  ii: TdInteractionInfo | undefined,
): { emoji: string; count: number }[] {
  return (ii?.reactions?.reactions ?? [])
    .filter((r) => r.type?._ === "reactionTypeEmoji" && r.type.emoji)
    .map((r) => ({ emoji: r.type!.emoji!, count: r.total_count ?? 0 }));
}

// Дескриптор медиа креатива для скачивания в норм-разрешении (фото — самый
// большой размер; видео — постер-превью, не воспроизводим). Общий для
// клиентского портала (/creatives) и превью у менеджера (step-media).
export const CreativeMediaSchema = z.object({
  idx: z.number().int(),
  kind: z.enum(["photo", "video"]),
  width: z.number().int(),
  height: z.number().int(),
});
export type CreativeMedia = {
  kind: "photo" | "video";
  fileId: number;
  width: number;
  height: number;
};
export function extractCreativeMedia(content: TdContent): CreativeMedia | null {
  if (content._ === "messagePhoto") {
    const sizes = content.photo?.sizes ?? [];
    if (sizes.length === 0) return null;
    // Для превью берём «x» (≈800px) — НЕ самый большой (y/w = 1280–2560px,
    // лишние мегабайты). Нет x → m (≈320px) → иначе самый большой по площади.
    const pick =
      sizes.find((s) => s.type === "x") ??
      sizes.find((s) => s.type === "m") ??
      sizes.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    return {
      kind: "photo",
      fileId: pick.photo.id,
      width: pick.width,
      height: pick.height,
    };
  }
  if (content._ === "messageVideo") {
    const file = content.video?.thumbnail?.file;
    if (!file) return null;
    return {
      kind: "video",
      fileId: file.id,
      width: content.video?.width ?? 0,
      height: content.video?.height ?? 0,
    };
  }
  return null;
}

// Сообщения альбома → дескрипторы медиа для превью (idx = индекс в альбоме).
// Общий для step-message (превью у менеджера) и /creatives (клиентский портал).
export function mapCreativeMediaList(
  messages: { content: TdContent }[],
): { idx: number; kind: "photo" | "video"; width: number; height: number }[] {
  return messages
    .map((m, idx) => {
      const mm = extractCreativeMedia(m.content);
      return mm
        ? { idx, kind: mm.kind, width: mm.width, height: mm.height }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// messageDocument → дескриптор файла (fileId для скачивания). null если не документ.
export function extractDocument(content: TdContent): MappedDocument | null {
  if (content._ !== "messageDocument") return null;
  const doc = content.document;
  const fileId = doc?.document?.id;
  if (typeof fileId !== "number") return null;
  return {
    fileId,
    fileName: doc?.file_name || "файл",
    mimeType: doc?.mime_type || "application/octet-stream",
    size: doc?.document?.size ?? 0,
  };
}

// Снимок опубликованного поста (фаза «Отчёт»): нормализованный контент, не сырой
// TDLib. Храним достаточное для рендера «хоть чего-то», даже если пост удалят:
// форматированный текст, тамбнейл (блюр), дескриптор медиа + messageId/chatId
// для дозагрузки full-res пока пост жив, и метрики на момент снимка. Файлы НЕ
// храним — медиа тянем on-demand, нет — остаётся тамбнейл.
export const PostSnapshotSchema = z.object({
  // Платформа поста. Отсутствует/undefined у старых TG-снимков — трактуем как
  // 'telegram'. У YouTube/TikTok — соответственно.
  platform: z.enum(["telegram", "youtube", "tiktok"]).optional(),
  // messageId/chatId — TG-специфика (дозагрузка full-res медиа). У провайдеров
  // (YT/TikTok) их нет.
  messageId: z.string().optional(),
  chatId: z.string().optional(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  // thumbB64 — TG-минитамбнейл (base64). coverUrl — обложка YT/TikTok (URL,
  // у TikTok с TTL). Рендер берёт coverUrl, иначе thumbB64.
  thumbB64: z.string().nullable(),
  thumbW: z.number().int().nullable(),
  thumbH: z.number().int().nullable(),
  coverUrl: z.string().nullable().optional(),
  // Ссылка на пост (у провайдеров дублирует postUrl размещения, для самодостаточности снимка).
  url: z.string().nullable().optional(),
  media: z
    .object({
      kind: z.enum(["photo", "video"]),
      width: z.number().int(),
      height: z.number().int(),
    })
    .nullable(),
  views: z.number().int().nullable(),
  forwards: z.number().int().nullable(),
  reactions: z.array(MessageReactionSchema),
  capturedAt: z.iso.datetime(),
});
export type PostSnapshot = z.infer<typeof PostSnapshotSchema>;

export function buildPostSnapshot(p: {
  messageId: string;
  chatId: string;
  content: TdContent | undefined;
  info: TdInteractionInfo | null | undefined;
  capturedAt: string;
}): PostSnapshot {
  const { text, entities } = p.content
    ? extractFormattedText(p.content)
    : { text: "", entities: [] };
  const thumb = p.content ? extractMediaThumb(p.content) : null;
  const cm = p.content ? extractCreativeMedia(p.content) : null;
  return {
    messageId: p.messageId,
    chatId: p.chatId,
    text,
    entities,
    thumbB64: thumb?.b64 ?? null,
    thumbW: thumb?.width ?? null,
    thumbH: thumb?.height ?? null,
    media: cm ? { kind: cm.kind, width: cm.width, height: cm.height } : null,
    views: p.info?.view_count ?? null,
    forwards: p.info?.forward_count ?? null,
    reactions: extractReactions(p.info ?? undefined),
    capturedAt: p.capturedAt,
  };
}

export function extractFormattedText(content: TdContent): {
  text: string;
  entities: MappedEntity[];
} {
  const ft = content._ === "messageText" ? content.text : content.caption;
  const text = ft?.text ?? "";
  if (!text) return { text: "", entities: [] };
  const entities = (ft?.entities ?? [])
    .map((e): MappedEntity | null => {
      const kind = ENTITY_KIND_BY_TD[e.type._];
      if (!kind) return null;
      return {
        offset: e.offset,
        length: e.length,
        kind,
        ...(kind === "textUrl" && e.type.url ? { url: e.type.url } : {}),
        ...(kind === "preCode" && e.type.language
          ? { language: e.type.language }
          : {}),
      };
    })
    .filter((e): e is MappedEntity => e !== null);
  return { text, entities };
}

export function extractMediaThumb(content: TdContent): MappedThumb | null {
  const media =
    content._ === "messagePhoto"
      ? { kind: "photo" as const, src: content.photo }
      : content._ === "messageVideo"
        ? { kind: "video" as const, src: content.video }
        : content._ === "messageAnimation"
          ? { kind: "animation" as const, src: content.animation }
          : null;
  if (!media?.src?.minithumbnail) return null;
  return {
    kind: media.kind,
    b64: media.src.minithumbnail.data,
    width: media.src.minithumbnail.width,
    height: media.src.minithumbnail.height,
  };
}

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

export type MappedEntity = z.infer<typeof TdMessageEntitySchema>;
export type MappedThumb = z.infer<typeof TdMediaThumbSchema>;

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
export type TdContent = {
  _: string;
  text?: TdFormattedText;
  caption?: TdFormattedText;
  photo?: TdMedia;
  video?: TdMedia;
  animation?: TdMedia;
};

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

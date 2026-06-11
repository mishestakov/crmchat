import type React from "react";
import { formatViews } from "./format";

// TG message entities + inline thumbnails — общий рендер для фида канала
// (channel-card.tsx) и контактного чата (contacts/index.tsx). Shape
// зеркалит то, что бэк отдаёт в /channels/.../history и /contacts/.../chat-history
// после фильтрации в ENTITY_KIND_BY_TD (apps/api/src/routes/channels.ts).

export type MessageEntityKind =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "pre"
  | "preCode"
  | "blockquote"
  | "url"
  | "textUrl"
  | "email"
  | "phone"
  | "mention"
  | "hashtag"
  | "cashtag";

export type MessageEntity = {
  offset: number;
  length: number;
  kind: MessageEntityKind;
  url?: string;
  language?: string;
};

export type MessageThumb = {
  kind: "photo" | "video" | "animation";
  b64: string;
  width: number;
  height: number;
};

// Inline-thumbnail из TDLib payload'а (jpeg ~250B). CSS-blur и как
// signal «это превью», и для маскировки артефактов масштабирования
// мелкого jpeg'а. Aspect-ratio по реальным dimensions.
export function MessageMediaThumb(props: { thumb: MessageThumb }) {
  const { thumb } = props;
  return (
    <div className="relative overflow-hidden bg-zinc-900">
      <img
        src={`data:image/jpeg;base64,${thumb.b64}`}
        alt=""
        className="block w-full object-cover blur-[2px]"
        style={{ aspectRatio: `${thumb.width} / ${thumb.height}` }}
      />
      {thumb.kind !== "photo" && (
        <span className="absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white">
          {thumb.kind === "video" ? "Видео" : "GIF"}
        </span>
      )}
    </div>
  );
}

// Full-res медиа: блюр-минитюмбнейл как мгновенный placeholder + полноразмер
// лениво поверх. Общий рендер для ленты канала и личного чата (байты тянет
// соответствующий bytes-роут, src передаёт вызывающий). Ошибка → прячем
// полноразмер, остаётся блюр.
export function FullResMedia(props: {
  src: string;
  thumb: MessageThumb | null;
  kind: "photo" | "video";
  width: number;
  height: number;
}) {
  return (
    <div
      className="relative overflow-hidden bg-zinc-900"
      style={{ aspectRatio: `${props.width} / ${props.height}` }}
    >
      {props.thumb && (
        <img
          src={`data:image/jpeg;base64,${props.thumb.b64}`}
          alt=""
          className="absolute inset-0 h-full w-full object-cover blur-[2px]"
        />
      )}
      <img
        src={props.src}
        alt=""
        loading="lazy"
        className="relative h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
      {props.kind === "video" && (
        <span className="absolute right-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white">
          Видео
        </span>
      )}
    </div>
  );
}

// Чипы реакций (эмодзи + счётчик) — общий вид для ленты канала и личного чата.
export function ReactionChips(props: {
  reactions: { emoji: string; count: number }[];
}) {
  if (props.reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {props.reactions.map((r) => (
        <span
          key={r.emoji}
          className="inline-flex items-center gap-0.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600"
        >
          <span>{r.emoji}</span>
          <span className="tabular-nums">{formatViews(r.count)}</span>
        </span>
      ))}
    </div>
  );
}

// Линейный entity-renderer: TDLib гарантирует не-пересекающиеся entities,
// но допускает вложенность. Single-pass подход: режем text по offset'ам,
// каждый entity — отдельный slice. Если новая entity пересекает предыдущую
// (вложенная) — внешняя выигрывает. Для feed'а каналов и DM-переписок
// этого достаточно — глубокая вложенность встречается крайне редко.
export function renderMessageEntities(
  text: string,
  entities: MessageEntity[],
): React.ReactNode {
  if (entities.length === 0) return text;
  const sorted = [...entities].sort((a, b) => a.offset - b.offset);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const e of sorted) {
    if (e.offset < cursor) continue;
    if (e.offset > cursor) out.push(text.slice(cursor, e.offset));
    const inner = text.slice(e.offset, e.offset + e.length);
    out.push(
      <EntitySpan key={`${e.offset}-${e.length}`} e={e} inner={inner} />,
    );
    cursor = e.offset + e.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function EntitySpan(props: { e: MessageEntity; inner: string }) {
  const { e, inner } = props;
  switch (e.kind) {
    case "bold":
      return <b>{inner}</b>;
    case "italic":
      return <i>{inner}</i>;
    case "underline":
      return <u>{inner}</u>;
    case "strikethrough":
      return <s>{inner}</s>;
    case "code":
      return (
        <code className="rounded bg-black/10 px-1 font-mono text-[12.5px]">
          {inner}
        </code>
      );
    case "pre":
      return (
        <pre className="my-1 overflow-x-auto rounded bg-black/10 p-2 font-mono text-[12.5px]">
          {inner}
        </pre>
      );
    case "preCode":
      return (
        <pre className="my-1 overflow-x-auto rounded bg-black/10 p-2 font-mono text-[12.5px]">
          <code className={e.language ? `lang-${e.language}` : undefined}>
            {inner}
          </code>
        </pre>
      );
    case "blockquote":
      return (
        <blockquote className="my-1 border-l-2 border-current/40 pl-2 opacity-90">
          {inner}
        </blockquote>
      );
    case "url":
      return (
        <a href={inner} target="_blank" rel="noreferrer" className="underline">
          {inner}
        </a>
      );
    case "textUrl":
      return (
        <a
          href={e.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {inner}
        </a>
      );
    case "email":
      return (
        <a href={`mailto:${inner}`} className="underline">
          {inner}
        </a>
      );
    case "phone":
      return (
        <a href={`tel:${inner.replace(/\s+/g, "")}`} className="underline">
          {inner}
        </a>
      );
    case "mention": {
      const handle = inner.startsWith("@") ? inner.slice(1) : inner;
      return (
        <a
          href={`https://t.me/${handle}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          {inner}
        </a>
      );
    }
    case "hashtag":
    case "cashtag":
      // Без подписки на канал-источник кликать некуда — оставляем подсветкой.
      return <span className="font-medium opacity-90">{inner}</span>;
  }
}

// URL file-proxy личного чата (байты по fileId аккаунта через
// /contacts/{id}/chat-file): документы, превью стикеров в ленте и пикере.
export function chatFileUrl(p: {
  wsId: string;
  contactId: string;
  accountId: string;
  fileId: number;
  name: string;
  mime: string;
}): string {
  return (
    `/v1/workspaces/${p.wsId}/contacts/${p.contactId}/chat-file` +
    `?accountId=${encodeURIComponent(p.accountId)}&fileId=${p.fileId}` +
    `&name=${encodeURIComponent(p.name)}&mime=${encodeURIComponent(p.mime)}`
  );
}

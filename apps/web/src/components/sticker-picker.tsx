import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-client";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useEscapeKey } from "../lib/hooks";
import { chatFileUrl } from "../lib/tg-message";

// Пикер эмодзи/стикеров композера (T3.5, супербазовый MVP). Показывает то,
// что установлено на текущем аккаунте в Telegram (эмодзи-наборы бэк отдаёт
// только premium-аккаунтам), ничего не устанавливаем из CRM. Всё статичное —
// анимации не воспроизводим. Два раздела: «Эмодзи» (юникод-сетка + кастом-
// наборы) и «Стикеры». Поиск — getStickers по установленным: эмодзи-символ
// или keywords (в основном английские), как в самом Telegram.
// Клик: юникод-эмодзи — в текст композера; стикер/кастом-эмодзи — отдельным
// сообщением сразу.

// Частые юникод-эмодзи (BD-переписка): без категорий — одна сетка, MVP.
const UNICODE_EMOJI =
  "😀 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😍 🥰 😘 😎 🤗 🤔 🤨 😐 😏 🙄 😬 😴 🤤 😭 😢 😡 🤬 🤯 😱 🥳 🤩 😇 🙃 🤝 👍 👎 👌 ✌️ 🤞 🙏 👏 💪 🤙 👋 🖐️ ✋ 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🔥 💯 ✨ ⭐ 🌟 🔥 🎉 🎊 🎁 🚀 ⚡ 💡 ✅ ❌ ⚠️ ❗ ❓ 💬 👀 🙈 🙉 🙊 🐱 🐶 🦆 🐳 ☕ 🍕 🍺 🥂 💰 💵 📈 📉 📊 📌 📎 🗓️ ⏰ 🕐 📞 💻 ✍️ 🤓 🫡 🤷 🤦 😺 😸 😻".split(
    " ",
  );

type PickerSet = components["schemas"]["StickerSetInfo"];
type PickerSticker = components["schemas"]["PickerSticker"];

export function StickerPicker(props: {
  wsId: string;
  contactId: string;
  accountId: string;
  onUnicode: (emoji: string) => void;
  onSticker: (remoteId: string) => void;
  onCustomEmoji: (id: string, emoji: string) => void;
  onClose: () => void;
}) {
  useEscapeKey(props.onClose);
  const [kind, setKind] = useState<"emoji" | "sticker">("emoji");
  // "unicode" (только в разделе эмодзи) | id набора
  const [tab, setTab] = useState<string>("unicode");
  const [q, setQ] = useState("");
  // Дебаунс: каждый запрос поиска = TDLib getStickers + сетка превью,
  // промежуточные префиксы («c», «ca»…) не нужны никому.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const setsQ = useQuery({
    queryKey: ["sticker-sets", props.wsId, props.accountId] as const,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/sticker-sets",
        {
          params: {
            path: { wsId: props.wsId },
            query: { accountId: props.accountId },
          },
        },
      );
      if (error) throw error;
      return data!.sets;
    },
  });

  const kindSets = (setsQ.data ?? []).filter((s) => s.kind === kind);
  // Активный набор с фолбэком: выбранная вкладка может не существовать в
  // текущем разделе (переключили раздел) — юникод / первый набор.
  const activeSet =
    kindSets.find((s) => s.id === tab) ??
    (kind === "sticker" ? (kindSets[0] ?? null) : null);
  const activeTab = activeSet?.id ?? "unicode";
  // Поиск кастом-эмодзи без premium-наборов бессмыслен (отправить нельзя).
  const searchable = kind === "sticker" || kindSets.length > 0;
  const searching = searchable && query.length > 0;

  const stickersQ = useQuery({
    queryKey: ["sticker-set", props.wsId, props.accountId, activeTab] as const,
    enabled: !!activeSet && !searching,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/sticker-sets/{setId}",
        {
          params: {
            path: { wsId: props.wsId, setId: activeTab },
            query: { accountId: props.accountId },
          },
        },
      );
      if (error) throw error;
      return data!.stickers;
    },
  });

  const searchQ = useQuery({
    queryKey: [
      "sticker-search",
      props.wsId,
      props.accountId,
      kind,
      query,
    ] as const,
    enabled: searching,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/sticker-search",
        {
          params: {
            path: { wsId: props.wsId },
            query: { accountId: props.accountId, kind, q: query },
          },
        },
      );
      if (error) throw error;
      return data!.stickers;
    },
  });

  // Байты превью — существующий chat-file (file-proxy по fileId аккаунта).
  const fileSrc = (fileId: number) =>
    chatFileUrl({
      wsId: props.wsId,
      contactId: props.contactId,
      accountId: props.accountId,
      fileId,
      name: "sticker.webp",
      mime: "image/webp",
    });

  const pick = (s: PickerSticker) => {
    if (kind === "emoji") {
      // Без юникод-фолбэка кастом-эмодзи в текст не вставить (по td_api.tl
      // emoji «may be empty») — такой клик честно игнорируем.
      if (s.customEmojiId && s.emoji) {
        props.onCustomEmoji(s.customEmojiId, s.emoji);
      }
    } else {
      props.onSticker(s.remoteId);
    }
  };

  const stickerGrid = (items: PickerSticker[]) => (
    <div className={"grid " + (kind === "emoji" ? "grid-cols-8" : "grid-cols-5")}>
      {items.map((s) => (
        <button
          key={s.remoteId}
          type="button"
          title={s.emoji}
          onClick={() => pick(s)}
          className="flex items-center justify-center rounded p-1 hover:bg-zinc-100"
        >
          {s.thumbFileId != null ? (
            <img
              src={fileSrc(s.thumbFileId)}
              alt={s.emoji}
              loading="lazy"
              className={
                kind === "emoji"
                  ? "h-7 w-7 object-contain"
                  : "h-14 w-14 object-contain"
              }
            />
          ) : (
            <span className="text-xl">{s.emoji || "❔"}</span>
          )}
        </button>
      ))}
    </div>
  );

  // Сетка вкладки/поиска: загрузка → ошибка → пусто → стикеры.
  const gridState = (qy: typeof stickersQ, emptyText: string) =>
    qy.isLoading ? (
      <p className="p-2 text-xs text-zinc-400">Загружаем…</p>
    ) : qy.error ? (
      <p className="p-2 text-xs text-red-600">{errorMessage(qy.error)}</p>
    ) : (qy.data ?? []).length === 0 ? (
      <p className="p-2 text-xs text-zinc-400">{emptyText}</p>
    ) : (
      stickerGrid(qy.data ?? [])
    );

  const kindCls = (active: boolean) =>
    "shrink-0 rounded-md px-2.5 py-1 text-xs font-medium " +
    (active
      ? "bg-emerald-600 text-white"
      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200");
  const tabCls = (active: boolean) =>
    "shrink-0 rounded px-2 py-0.5 text-[11px] " +
    (active
      ? "bg-zinc-200 font-medium text-zinc-900"
      : "text-zinc-500 hover:bg-zinc-100");

  return (
    <>
      <div className="fixed inset-0 z-20" onClick={props.onClose} />
      <div className="absolute inset-x-0 bottom-full z-30 mb-1 flex h-80 flex-col rounded-lg border border-zinc-200 bg-white shadow-lg">
        <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setKind("emoji")}
            className={kindCls(kind === "emoji")}
          >
            Эмодзи
          </button>
          <button
            type="button"
            onClick={() => setKind("sticker")}
            className={kindCls(kind === "sticker")}
          >
            Стикеры
          </button>
          {searchable && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск: 😍 или cat"
              className="ml-auto w-36 rounded-md border border-zinc-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
            />
          )}
        </div>
        {!searching && (
          <div className="flex gap-1 overflow-x-auto border-b border-zinc-100 px-2 py-1">
            {kind === "emoji" && (
              <button
                type="button"
                onClick={() => setTab("unicode")}
                className={tabCls(activeTab === "unicode")}
              >
                🙂 Обычные
              </button>
            )}
            {kindSets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setTab(s.id)}
                className={tabCls(activeTab === s.id)}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2">
          {searching ? (
            gridState(searchQ, "Ничего не нашлось")
          ) : kind === "emoji" && activeTab === "unicode" ? (
            <div className="grid grid-cols-8">
              {UNICODE_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => props.onUnicode(e)}
                  className="rounded p-1 text-xl hover:bg-zinc-100"
                >
                  {e}
                </button>
              ))}
            </div>
          ) : activeSet ? (
            gridState(stickersQ, "Набор пуст")
          ) : (
            <p className="p-2 text-xs text-zinc-400">
              {setsQ.isLoading
                ? "Загружаем наборы…"
                : kind === "sticker"
                  ? "На аккаунте нет стикер-наборов — добавьте их в Telegram, здесь появятся сами."
                  : "На аккаунте нет эмодзи-наборов."}
            </p>
          )}
        </div>
        {setsQ.error != null && (
          <p className="border-t border-zinc-100 px-3 py-1.5 text-xs text-red-600">
            {errorMessage(setsQ.error)}
          </p>
        )}
      </div>
    </>
  );
}

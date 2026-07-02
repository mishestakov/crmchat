import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { components } from "@repo/api-client";
import { api } from "../lib/api";
import { MessageMediaThumb, renderMessageEntities } from "../lib/tg-message";

// Публичная read-only переписка по magic-link. Вне _authenticated — без sidebar
// и session-auth (доступ по токену в URL). Вставляется в карточку внешней CRM.
// Данные — live через TDLib (only_local на бэке), обновляются сами.

export const Route = createFileRoute("/share/conv/$token")({
  component: ConversationSharePage,
});

type ConversationMessages = components["schemas"]["ConversationMessages"];
type ShareMessage = ConversationMessages["messages"][number];

function ConversationSharePage() {
  const { token } = Route.useParams();

  useEffect(() => {
    // noindex: публичная ссылка на личную переписку не должна индексироваться.
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const q = useInfiniteQuery({
    queryKey: ["share-conv", token] as const,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await api.GET("/v1/share/conv/{token}/messages", {
        params: {
          path: { token },
          query: pageParam ? { before: pageParam } : {},
        },
      });
      if (error) throw error;
      return data!;
    },
    initialPageParam: undefined as string | undefined,
    // Курсор следующей (более старой) страницы = id самого старого сообщения;
    // страницы newest-first → это последний элемент. Пустая страница →
    // undefined → hasNextPage=false (достигли начала истории).
    getNextPageParam: (last) => last.messages.at(-1)?.id,
    retry: false,
  });

  const first = q.data?.pages[0];
  // Страницы newest-first; склеиваем и реверсим для показа старые→новые.
  const ordered = (q.data?.pages.flatMap((p) => p.messages) ?? [])
    .slice()
    .reverse();

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-2xl">
          <div className="text-sm font-semibold text-zinc-900">
            {first?.title || "Переписка"}
          </div>
          <div className="text-xs text-zinc-500">
            Только чтение · снимок переписки
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">
        {q.isPending && (
          <div className="text-sm text-zinc-400">Загрузка…</div>
        )}
        {q.isError && (
          <div className="rounded-lg bg-white p-6 text-center text-sm text-red-600">
            Ссылка недействительна.
          </div>
        )}
        {!q.isPending && !q.isError && first?.unavailable && (
          <div className="rounded-lg bg-white p-6 text-center text-sm text-zinc-500">
            Переписка временно недоступна. Попробуйте обновить страницу позже.
          </div>
        )}
        {!q.isPending && !q.isError && !first?.unavailable && (
          <div className="space-y-2">
            {q.hasNextPage && ordered.length > 0 && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => q.fetchNextPage()}
                  disabled={q.isFetchingNextPage}
                  className="rounded-full bg-white px-3 py-1 text-xs text-zinc-600 ring-1 ring-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {q.isFetchingNextPage ? "Загрузка…" : "Показать более ранние"}
                </button>
              </div>
            )}
            {ordered.length === 0 && (
              <div className="text-sm text-zinc-400">
                Сообщений нет или переписка ещё загружается — обновите страницу
                чуть позже.
              </div>
            )}
            {ordered.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function MessageBubble({ m }: { m: ShareMessage }) {
  const mine = m.isOutgoing;
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={
          "max-w-[80%] overflow-hidden rounded-2xl text-sm ring-1 ring-zinc-200 " +
          (mine ? "bg-emerald-100" : "bg-white")
        }
      >
        {m.mediaThumb && <MessageMediaThumb thumb={m.mediaThumb} />}
        {!m.mediaThumb && (m.document || m.sticker) && (
          <div className="px-3 py-2 text-zinc-500">
            {m.sticker
              ? m.sticker.emoji || "Стикер"
              : `📎 ${m.document?.fileName ?? "файл"}`}
          </div>
        )}
        {m.text && (
          <div className="whitespace-pre-wrap break-words px-3 py-2 text-zinc-900">
            {renderMessageEntities(m.text, m.entities)}
          </div>
        )}
        <div className="px-3 pb-1 text-right text-[10px] text-zinc-400">
          {new Date(m.date).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

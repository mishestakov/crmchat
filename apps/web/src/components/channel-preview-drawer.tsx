import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "../lib/errors";
import { Post, type ChannelMessage } from "./channel-card";
import { Drawer } from "./drawer";

// Дровер предпросмотра канала: лента постов из ЛОКАЛЬНОГО кэша TDLib
// (бэкенд читает only_local — ноль сетевых запросов). Общий для согласования
// (менеджер, /channels/{id}/preview) и клиентской ссылки (/share/.../preview):
// каждый передаёт свой queryFn, рендер постов один и тот же (Post из карточки).
export function ChannelPreviewDrawer(props: {
  title: string;
  queryKey: readonly unknown[];
  queryFn: () => Promise<ChannelMessage[]>;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: props.queryKey as unknown[],
    queryFn: props.queryFn,
    staleTime: 60_000,
  });
  const posts = q.data ?? [];
  return (
    <Drawer
      width={480}
      onClose={props.onClose}
      title={
        <div className="min-w-0">
          <div className="truncate font-medium">{props.title}</div>
          <div className="text-xs text-zinc-500">Предпросмотр · из кэша</div>
        </div>
      }
    >
        <div className="flex-1 overflow-y-auto bg-zinc-50 p-3">
          {q.isLoading ? (
            <p className="text-sm text-zinc-400">Загрузка…</p>
          ) : q.error ? (
            <p className="text-sm text-red-600">{errorMessage(q.error)}</p>
          ) : posts.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-zinc-400">
              Нет кэшированных постов. Откройте канал в лонглисте, чтобы
              подтянуть ленту — потом предпросмотр покажет её без обращений к
              Telegram.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {posts.map((m) => (
                <Post key={m.id} m={m} />
              ))}
            </div>
          )}
        </div>
    </Drawer>
  );
}

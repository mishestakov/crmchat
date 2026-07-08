import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ChannelCard } from "./channel-card";
import { Drawer } from "./drawer";

// Единый дровер «Лента канала» для ВНУТРЕННИХ превью (согласование + placement).
// Тянет полный канал и отдаёт его в рабочую ChannelCard (compact): она сама
// авто-синкает и рендерит ленту по платформе — telegram-историю ИЛИ провайдерные
// видео (meta.recent_videos). Раньше превью били напрямую в /history
// (telegram-only → «history supported only for platform=telegram») или /preview
// (для провайдеров пусто → «Нет кэшированных постов»); диспатч по платформе жил
// в разных местах, поэтому легко было «позвать не ту ручку». Тут точка одна.
// Клиентская share-ссылка сюда НЕ ходит (нет авторизации/TDLib-аккаунта) — у неё
// свой ChannelPreviewDrawer.
export function ChannelFeedDrawer(props: {
  wsId: string;
  channelId: string;
  title: string;
  onClose: () => void;
}) {
  const q = useQuery({
    // Тот же ключ, что у channelQ карточек — react-query дедупит, повторного
    // запроса на открытие превью нет.
    queryKey: ["channel", props.wsId, props.channelId] as const,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/channels/{id}",
        { params: { path: { wsId: props.wsId, id: props.channelId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
  return (
    <Drawer
      width={480}
      onClose={props.onClose}
      title={
        <div className="min-w-0">
          <div className="truncate font-medium">{props.title}</div>
          <div className="text-xs text-zinc-500">Лента канала</div>
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.data ? (
          <ChannelCard wsId={props.wsId} channel={q.data} compact />
        ) : q.error ? (
          <p className="p-3 text-sm text-red-600">Не удалось загрузить канал</p>
        ) : (
          <p className="p-3 text-sm text-zinc-400">Загрузка канала…</p>
        )}
      </div>
    </Drawer>
  );
}

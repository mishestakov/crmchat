import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { useEscapeKey } from "../lib/hooks";
import { ChannelCard } from "./channel-card";

// queryKey ["channel", wsId, id] — общий с ChannelCard sync-mutation, чтобы
// после force-sync в drawer'е инвалидировалась та же запись.
export function ChannelDrawer(props: {
  wsId: string;
  channelId: string;
  onClose: () => void;
  // Открыть карточку сразу с тредом лички (клик по DM-бейджу в каталоге).
  initialDmOpen?: boolean;
}) {
  useEscapeKey(props.onClose);

  const channelQ = useQuery({
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
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/20"
        onClick={props.onClose}
      />
      <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[560px] max-w-[95vw] flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 text-xs">
          <button
            type="button"
            onClick={props.onClose}
            className="text-zinc-500 hover:text-zinc-700"
          >
            ← Закрыть
          </button>
        </div>
        {channelQ.isLoading && (
          <p className="px-6 py-4 text-sm text-zinc-500">Загрузка канала…</p>
        )}
        {channelQ.error && (
          <p className="px-6 py-4 text-sm text-red-600">
            {errorMessage(channelQ.error)}
          </p>
        )}
        {channelQ.data && (
          <ChannelCard
            key={props.channelId}
            wsId={props.wsId}
            channel={channelQ.data}
            initialDmOpen={props.initialDmOpen}
          />
        )}
      </aside>
    </>
  );
}

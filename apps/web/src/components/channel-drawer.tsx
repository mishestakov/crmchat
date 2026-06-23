import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { ChannelCard } from "./channel-card";
import { ContactResolver } from "./contact-resolver";
import { Drawer } from "./drawer";

// queryKey ["channel", wsId, id] — общий с ChannelCard sync-mutation, чтобы
// после force-sync в drawer'е инвалидировалась та же запись.
export function ChannelDrawer(props: {
  wsId: string;
  channelId: string;
  onClose: () => void;
  // Открыть карточку сразу с тредом лички (клик по DM-бейджу в каталоге).
  initialDmOpen?: boolean;
  // Открыть сразу в режиме «Сменить контакт» (шорткат из шапки чата) — минуя
  // карточку. После успешной смены onResolved (обновить переписку), затем close.
  contactChange?: boolean;
  onResolved?: () => void;
}) {
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

  const title = props.contactChange
    ? "Сменить контакт"
    : (channelQ.data?.title ?? "Канал");

  return (
    <Drawer
      width={560}
      onClose={props.onClose}
      title={
        <span className="block truncate text-sm font-medium text-zinc-700">
          {title}
        </span>
      }
    >
      {channelQ.isLoading && (
        <p className="px-6 py-4 text-sm text-zinc-500">Загрузка канала…</p>
      )}
      {channelQ.error && (
        <p className="px-6 py-4 text-sm text-red-600">
          {errorMessage(channelQ.error)}
        </p>
      )}
      {channelQ.data &&
        (props.contactChange ? (
          <ContactResolver
            wsId={props.wsId}
            channelId={props.channelId}
            channel={channelQ.data}
            onResolved={props.onResolved}
            onClose={props.onClose}
          />
        ) : (
          <ChannelCard
            key={props.channelId}
            wsId={props.wsId}
            channel={channelQ.data}
            initialDmOpen={props.initialDmOpen}
          />
        ))}
    </Drawer>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight } from "lucide-react";
import { api } from "../lib/api";

// Маркер «Telegram нашёл ДРУГОГО админа канала» (channel.suggestedAdmin):
// авто-детект при импорте разошёлся с текущим получателем размещения. Без него
// карточка выглядит «зомби» — ведём старого контакта, хотя админ уже другой.
// Клик = осознанный set-admin на предложенного @: repoint размещения БЕЗ
// автоотправки (опенер новому оператор шлёт вручную), а heal сам гасит
// suggested_admin в meta канала. Общий для списка лидов и канбана.
export function AdminSuggestionBadge(props: {
  wsId: string;
  channelId: string;
  suggestedAdmin: string;
}) {
  const qc = useQueryClient();
  const handle = props.suggestedAdmin.replace(/^@/, "");
  const switchAdmin = useMutation({
    mutationFn: async () => {
      const { error } = await api.POST(
        "/v1/workspaces/{wsId}/channels/{id}/set-admin",
        {
          params: { path: { wsId: props.wsId, id: props.channelId } },
          body: { username: handle },
        },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      // set-admin перенаводит project_items (heal) и снимает suggested_admin →
      // карточки лидов (префикс без projectId — рефетчатся смонтированные) и
      // карточка канала устаревают.
      qc.invalidateQueries({ queryKey: ["project-leads", props.wsId] });
      qc.invalidateQueries({
        queryKey: ["channel", props.wsId, props.channelId],
      });
    },
  });
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // клик по строке открывает drawer
        switchAdmin.mutate();
      }}
      disabled={switchAdmin.isPending}
      title={`Telegram: админ канала теперь @${handle}. Перевести размещение на него — без автоотправки, опенер отправите вручную.`}
      className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-50"
    >
      <ArrowLeftRight size={11} className="shrink-0" />
      админ сменился → @{handle}
    </button>
  );
}

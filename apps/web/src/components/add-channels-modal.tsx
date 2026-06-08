import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/errors";
import { Modal } from "./modal";

// Массовое добавление каналов в проект (placements/bulk). Общий компонент для
// BD и agency — несущий слой канало-центричной схемы один. Каждая строка ввода
// — @username или ссылка; канал заводится/находится в базе, получатель аутрича
// резолвится от админа канала. Рассылка отсюда НЕ запускается.
//
// Тексты параметризованы (agency говорит «блогеры в лонглист», BD — «каналы»).
// База каналов (queryKey ["channels", wsId]) инвалидируется всегда; остальное —
// через onAdded (список размещений/лидов конкретного экрана).
export function AddChannelsModal(props: {
  wsId: string;
  projectId: string;
  onClose: () => void;
  title?: string;
  unit?: (n: number) => string;
  onAdded?: () => void;
}) {
  const {
    wsId,
    projectId,
    onClose,
    title = "Добавить каналы",
    unit = (n) => `${n} каналов`,
    onAdded,
  } = props;
  const qc = useQueryClient();
  const [bulkText, setBulkText] = useState("");
  const bulkLines = bulkText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const add = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST(
        "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
        {
          params: { path: { wsId, projectId } },
          body: { identifiers: bulkLines },
        },
      );
      if (error) throw error;
      return data!;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels", wsId] });
      onAdded?.();
      // Не закрываем сразу — показываем итог (особенно когда часть пропущена).
    },
  });

  const res = add.data;

  return (
    <Modal onClose={onClose} size="lg">
      <h2 className="mb-1 text-base font-semibold">{title}</h2>
      {res ? (
        <div className="mt-3">
          <p className="text-sm text-zinc-700">
            Добавлено: <b>{res.added}</b>
            {res.channelsCreated > 0 && ` · создано каналов: ${res.channelsCreated}`}
            {res.skippedDuplicate > 0 && ` · уже были: ${res.skippedDuplicate}`}
            {res.skippedInvalid > 0 && ` · не распознано: ${res.skippedInvalid}`}
          </p>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Готово
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-xs text-zinc-500">
            По одной ссылке или @username на строку. Каналы сразу просканируются
            (подписчики, описание, личка) и сопоставятся с базой контактов.
            Рассылка не запускается — это отдельная кнопка «Запустить аутрич».
          </p>
          <textarea
            autoFocus
            rows={7}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            placeholder={
              "По одной на строку. Telegram — @username, YouTube/TikTok — ссылкой:\n@durov\nhttps://youtube.com/@mkbhd\nhttps://tiktok.com/@khaby.lame"
            }
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm focus:border-emerald-500 focus:outline-none"
          />
          {add.error && (
            <p className="mt-2 text-sm text-red-600">{errorMessage(add.error)}</p>
          )}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-zinc-500">{unit(bulkLines.length)}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={bulkLines.length === 0 || add.isPending}
                onClick={() => add.mutate()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Plus size={15} />
                {add.isPending ? "Добавляем…" : `Добавить (${bulkLines.length})`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

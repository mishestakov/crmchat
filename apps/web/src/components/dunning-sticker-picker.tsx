import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { api } from "../lib/api";

// Пикер котиков для пиналки: менеджер вставляет ссылку/имя стикерпака → стикеры
// показываются картинками (превью через /sticker-file) → галочками отмечает →
// в пул сохраняются (setName, uniqueId). Картинки тянутся из телеги live, не
// хранятся в проекте.

// Имя пака из ссылки t.me/addstickers/NAME, t.me/s/NAME или просто NAME / @NAME.
function parsePackName(input: string): string {
  const m = input.trim().match(/(?:addstickers\/|t\.me\/s\/)([A-Za-z0-9_]+)/);
  return m ? m[1]! : input.trim().replace(/^@/, "");
}

export function DunningStickerPicker(props: {
  wsId: string;
  accountId: string;
  selected: Set<string>; // uniqueId'ы, уже добавленные в пул
  onToggle: (setName: string, uniqueId: string) => void;
  onClose: () => void;
}) {
  const { wsId, accountId, selected, onToggle, onClose } = props;
  const [input, setInput] = useState("");
  const [name, setName] = useState("");

  const packQ = useQuery({
    queryKey: ["sticker-pack", wsId, accountId, name],
    enabled: name !== "",
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/v1/workspaces/{wsId}/sticker-pack",
        { params: { path: { wsId }, query: { accountId, name } } },
      );
      if (error) throw error;
      return data;
    },
  });

  const thumbSrc = (fileId: number) =>
    `/v1/workspaces/${wsId}/sticker-file?accountId=${accountId}&fileId=${fileId}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium">Котики из стикерпака</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setName(parsePackName(input));
            }}
            placeholder="ссылка t.me/addstickers/… или имя пака"
            className="flex-1 rounded border border-zinc-200 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={() => setName(parsePackName(input))}
            className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Загрузить
          </button>
        </div>

        {packQ.isLoading && (
          <p className="mt-3 text-xs text-zinc-400">Загрузка…</p>
        )}
        {packQ.error && (
          <p className="mt-3 break-all text-xs text-red-600">
            {(() => {
              const e = packQ.error as { message?: string } | string;
              return typeof e === "string"
                ? e
                : (e?.message ?? JSON.stringify(packQ.error));
            })()}
          </p>
        )}
        {packQ.data && (
          <>
            <p className="mt-3 text-xs text-zinc-500">
              {packQ.data.title} — кликай котиков ({selected.size} выбрано)
            </p>
            <div className="mt-2 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto">
              {packQ.data.stickers.map((s) => {
                if (!s.uniqueId) return null;
                const uid = s.uniqueId;
                const on = selected.has(uid);
                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => onToggle(packQ.data!.setName, uid)}
                    className={
                      "relative rounded-lg border p-1 " +
                      (on
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-zinc-200 hover:bg-zinc-50")
                    }
                  >
                    {s.thumbFileId != null ? (
                      <img
                        src={thumbSrc(s.thumbFileId)}
                        alt={s.emoji}
                        className="h-32 w-32 object-contain"
                      />
                    ) : (
                      <span className="flex h-32 w-32 items-center justify-center text-2xl">
                        {s.emoji}
                      </span>
                    )}
                    {on && (
                      <span className="absolute right-0.5 top-0.5 text-sm text-emerald-600">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

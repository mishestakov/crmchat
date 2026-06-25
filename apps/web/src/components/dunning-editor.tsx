import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { canFillDunning } from "@repo/core";
import { api } from "../lib/api";
import { VariableTextarea, type VariableOption } from "./variable-textarea";
import { DunningStickerPicker } from "./dunning-sticker-picker";

// Пиналка — три независимые оси (§1.3 bd-autodogon): пул фраз × пул котиков ×
// ритм. Машина накладывает чередование текст/котик на ритм и тянет контент из
// пулов случайно, без повтора. Это НЕ цепочка сообщений — контент и задержки
// развязаны, поэтому редактор свой, а не MessagesEditor.
export type Variant =
  | { kind: "text"; text: string }
  | { kind: "sticker"; setName: string; uniqueId: string };
export type Delay = { period: "minutes" | "hours" | "days"; value: number };
export type Dunning = { pings: Variant[]; intervals: Delay[] };

export function DunningEditor(props: {
  value: Dunning;
  onChange: (next: Dunning) => void;
  variables: VariableOption[];
  // Аккаунт воркспейса для резолва стикерпаков (live-превью котиков). null —
  // нет подключённого аккаунта, пикер недоступен.
  wsId: string;
  accountId: string | null;
  disabled?: boolean;
}) {
  const { value, onChange, variables, wsId, accountId, disabled } = props;
  const [showPicker, setShowPicker] = useState(false);
  const texts = value.pings.filter((p) => p.kind === "text");
  const stickers = value.pings.filter((p) => p.kind === "sticker");
  const selectedIds = new Set(stickers.map((s) => s.uniqueId));

  // Превью выбранных котиков: резолвим их паки (по setName) и берём thumbFileId
  // по uniqueId. file_id непереносим — поэтому храним (setName,uniqueId), а
  // картинку тянем из телеги live (как пикер). Один запрос на пак, не на котика.
  const setNames = [...new Set(stickers.map((s) => s.setName))];
  const packQueries = useQueries({
    queries: setNames.map((name) => ({
      queryKey: ["sticker-pack", wsId, accountId, name] as const,
      enabled: !!accountId,
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const { data, error } = await api.GET(
          "/v1/workspaces/{wsId}/sticker-pack",
          { params: { path: { wsId }, query: { accountId: accountId!, name } } },
        );
        if (error) throw error;
        return data;
      },
    })),
  });
  const thumbByUnique = new Map<string, number>();
  for (const q of packQueries) {
    q.data?.stickers.forEach((s) => {
      if (s.uniqueId && s.thumbFileId != null)
        thumbByUnique.set(s.uniqueId, s.thumbFileId);
    });
  }
  const thumbSrc = (fileId: number) =>
    `/v1/workspaces/${wsId}/sticker-file?accountId=${accountId}&fileId=${fileId}`;

  // pings = тексты + котики (порядок не важен — машина чередует по kind).
  const setPings = (nextTexts: Variant[], nextStickers: Variant[]) =>
    onChange({ ...value, pings: [...nextTexts, ...nextStickers] });

  const updateText = (i: number, text: string) => {
    const next = texts.slice();
    next[i] = { kind: "text", text };
    setPings(next, stickers);
  };
  const removeText = (i: number) =>
    setPings(texts.filter((_, j) => j !== i), stickers);
  const addText = () => setPings([...texts, { kind: "text", text: "" }], stickers);

  const toggleSticker = (setName: string, uniqueId: string) =>
    selectedIds.has(uniqueId)
      ? setPings(texts, stickers.filter((s) => s.uniqueId !== uniqueId))
      : setPings(texts, [...stickers, { kind: "sticker", setName, uniqueId }]);

  const setStep = (i: number, days: number) => {
    const next = value.intervals.slice();
    next[i] = { period: "days", value: days };
    onChange({ ...value, intervals: next });
  };
  const addStep = () =>
    onChange({
      ...value,
      intervals: [...value.intervals, { period: "days", value: 3 }],
    });
  const removeStep = () =>
    onChange({ ...value, intervals: value.intervals.slice(0, -1) });

  const n = value.intervals.length;
  const enough = canFillDunning(texts.length, stickers.length, n);

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      {/* Фразы */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-zinc-600">
          Фразы{" "}
          <span className="font-normal text-zinc-400">
            — машина шлёт случайную, без повтора
          </span>
        </div>
        {texts.map((t, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <VariableTextarea
              value={t.text}
              onChange={(text) => updateText(i, text)}
              variables={variables}
              rows={2}
              placeholder="ну как, вы тут? :)"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => removeText(i)}
              className="mt-1.5 text-zinc-300 hover:text-red-600"
              aria-label="Убрать фразу"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addText}
          className="text-xs font-medium text-emerald-700 hover:underline"
        >
          + фраза
        </button>
      </div>

      {/* Котики */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-zinc-600">
          Котики <span className="font-normal text-zinc-400">— разбавляют</span>
        </div>
        {stickers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {stickers.map((s) => {
              const fid = thumbByUnique.get(s.uniqueId);
              return (
                <div key={s.uniqueId} className="group relative">
                  {fid != null ? (
                    <img
                      src={thumbSrc(fid)}
                      alt="котик"
                      className="h-32 w-32 rounded-lg border border-zinc-200 object-contain"
                    />
                  ) : (
                    <div className="flex h-32 w-32 items-center justify-center rounded-lg border border-zinc-200 text-2xl text-zinc-300">
                      🐱
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleSticker(s.setName, s.uniqueId)}
                    title="Убрать котика"
                    className="absolute -right-1.5 -top-1.5 rounded-full border border-zinc-300 bg-white p-0.5 text-zinc-500 shadow-sm hover:text-red-600"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {accountId ? (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            + котики из пака
          </button>
        ) : (
          <span className="text-[11px] text-amber-600">
            нужен подключённый аккаунт
          </span>
        )}
      </div>
      {showPicker && accountId && (
        <DunningStickerPicker
          wsId={wsId}
          accountId={accountId}
          selected={selectedIds}
          onToggle={toggleSticker}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Ритм */}
      <div className="space-y-1.5">
        <div className="text-xs font-medium text-zinc-600">
          Ритм серии{" "}
          <span className="font-normal text-zinc-400">
            — через сколько дней пинговать (тип чередуется автоматически)
          </span>
        </div>
        {value.intervals.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-4 text-right text-zinc-400">{i + 1}</span>
            <span
              className={
                "w-12 text-xs " +
                (i % 2 === 0 ? "text-zinc-600" : "text-amber-600")
              }
            >
              {i % 2 === 0 ? "текст" : "котик"}
            </span>
            <span className="text-zinc-400">через</span>
            <input
              type="number"
              min={1}
              max={365}
              value={d.value}
              onChange={(e) => setStep(i, Math.max(1, Number(e.target.value) || 1))}
              className="w-16 rounded border border-zinc-200 px-1.5 py-0.5"
            />
            <span className="text-zinc-400">дн.</span>
          </div>
        ))}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={addStep}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            + шаг
          </button>
          {n > 0 && (
            <button
              type="button"
              onClick={removeStep}
              className="text-xs text-zinc-400 hover:text-red-600"
            >
              убрать последний
            </button>
          )}
        </div>
        <div
          className={"text-[11px] " + (enough ? "text-zinc-400" : "text-red-600")}
        >
          {enough
            ? `хватает: ${texts.length} фраз, ${stickers.length} котиков на ${n} шагов`
            : `не хватает: нужно ≥${Math.ceil(n / 2)} фраз и ≥${Math.floor(n / 2)} котиков на ${n} шагов`}
        </div>
      </div>
    </fieldset>
  );
}

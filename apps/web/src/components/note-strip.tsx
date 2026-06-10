import { useState } from "react";
import { StickyNote } from "lucide-react";
import type { EntityNote } from "@repo/core";
import { errorMessage } from "../lib/errors";
import { formatNoteByline } from "../lib/date-utils";

// Янтарная полоса-памятка (канал/контакт): три состояния — пусто (тихая
// кнопка), сохранено (полоса с автором/датой, клик = править), редактирование.
// Сущность-специфика (endpoint, инвалидации) у тонких обёрток ContactNote /
// ChannelNote; onSave-promise: resolve → закрыть редактор, reject → ошибка.
export function NoteStrip(props: {
  note: EntityNote | null;
  addLabel: string; // «пометка об админе» / «пометка о канале»
  placeholder: string;
  title: string; // tooltip на сохранённой полосе
  px?: "px-4" | "px-5";
  onSave: (text: string) => Promise<unknown>;
}) {
  const px = props.px ?? "px-4";
  const saved = props.note?.text ?? "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await props.onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className={`space-y-1.5 border-b border-amber-200 bg-amber-50 ${px} py-2`}>
        <textarea
          autoFocus
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={props.placeholder}
          className="w-full resize-none rounded-md border border-amber-300 bg-white px-2 py-1 text-xs focus:border-amber-500 focus:outline-none"
        />
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-zinc-500 hover:text-zinc-700"
          >
            Отмена
          </button>
          {error && <span className="text-red-600">{error}</span>}
        </div>
      </div>
    );
  }
  if (!saved) {
    return (
      <div className={`border-b border-zinc-100 ${px} py-1`}>
        <button
          type="button"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-amber-700"
        >
          <StickyNote size={11} /> {props.addLabel}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(saved);
        setEditing(true);
      }}
      title={props.title}
      className={`flex w-full items-start gap-1.5 border-b border-amber-200 bg-amber-50 ${px} py-1.5 text-left text-xs text-amber-900 hover:bg-amber-100`}
    >
      <StickyNote size={12} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{saved}</span>
      {props.note && (
        <span className="shrink-0 pl-2 text-[10px] text-amber-700/70">
          {formatNoteByline(props.note)}
        </span>
      )}
    </button>
  );
}

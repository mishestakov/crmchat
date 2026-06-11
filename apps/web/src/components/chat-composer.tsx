import { useEffect, useRef } from "react";
import { Send } from "lucide-react";

// Единое поле отправки для всех чатов (TG-переписка, MAX, группа/личка
// канала): autosize до ~40% окна, Enter — отправить, Shift+Enter — перенос.
// До унификации было три расходящихся textarea (autosize только у TG) —
// каждую фичу композера (эмодзи, скрепка, reply) пришлось бы делать ×3.
// Рендерит только ряд «поле + кнопка» и ошибку; контейнер/рамку даёт parent.
export function ChatComposer(props: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder: string;
  error?: string | null;
  // Стартовая высота: 3 строки в основном чате, 1 — в узких рельсах.
  compact?: boolean;
  // Акцент площадки (MAX — фиолетовый).
  accent?: "emerald" | "violet";
  // Слот над кнопкой отправки (кнопка эмодзи-пикера в TG-чате) — справа
  // колонкой, чтобы не ужимать textarea с двух сторон.
  beforeSend?: React.ReactNode;
}) {
  const canSend = props.value.trim().length > 0 && !props.sending;
  // height=auto перед замером — иначе scrollHeight не уменьшается при
  // удалении строк.
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    // border-box: в height входит рамка, а в scrollHeight — нет. Без поправки
    // контенту вечно не хватает 2px и скроллбар не гаснет.
    const borders = ta.offsetHeight - ta.clientHeight;
    ta.style.height = `${Math.min(ta.scrollHeight + borders, window.innerHeight * 0.4)}px`;
  }, [props.value]);
  const violet = props.accent === "violet";
  return (
    <>
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          value={props.value}
          rows={props.compact ? 1 : 3}
          placeholder={props.placeholder}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter — отправка. Shift+Enter — перенос строки (нативный
            // textarea-behavior, не перехватываем).
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              props.onSend();
            }
          }}
          className={
            "min-w-0 flex-1 resize-none overflow-y-auto rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:outline-none " +
            (violet ? "focus:border-violet-500" : "focus:border-emerald-500")
          }
        />
        <div className="flex shrink-0 flex-col items-center gap-1">
          {props.beforeSend}
          <button
            type="button"
            onClick={props.onSend}
            disabled={!canSend}
            title="Отправить (Enter); перенос — Shift+Enter"
            className={
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white disabled:opacity-40 " +
              (violet
                ? "bg-violet-600 hover:bg-violet-700"
                : "bg-emerald-600 hover:bg-emerald-700")
            }
          >
            <Send size={16} />
          </button>
        </div>
      </div>
      {props.error && (
        <p className="mt-1 text-xs text-red-600">{props.error}</p>
      )}
    </>
  );
}

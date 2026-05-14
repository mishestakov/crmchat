import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Braces } from "lucide-react";

// Textarea с popover-автокомплитом переменных по триггеру `{{` или клику
// по иконке `{}`. На выходе обычная строка `... {{varname}} ...`.
//
// Своя реализация вместо Lexical: chip-рендер переменных в textarea
// невозможен (нужен contentEditable), но автокомплит закрывается без
// node-based редактора в ~190 строк.
//
// Popover рендерится через createPortal в document.body — родительский
// `<Section>` с `overflow-hidden` (ради скруглённых углов карточек)
// обрезал бы absolute-popover внутри.

export type VariableOption = {
  key: string;
  label?: string;
};

type MenuMode =
  | { kind: "closed" }
  | { kind: "trigger"; start: number; filter: string } // открыт триггером `{{`
  | { kind: "picker" }; // открыт кликом по иконке

const CLOSED: MenuMode = { kind: "closed" };

export function VariableTextarea(props: {
  value: string;
  onChange: (next: string) => void;
  variables: VariableOption[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<MenuMode>(CLOSED);
  const [highlight, setHighlight] = useState(0);

  // На любое изменение value+caret (печать, клик, стрелки, paste) пересобираем
  // mode. Распознавание `{{` чище через единую функцию, чем разделять
  // onKeyDown по триггер-символам.
  const recompute = useCallback(() => {
    const ta = ref.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = ta.value.slice(0, caret);
    const idx = before.lastIndexOf("{{");
    if (idx === -1) {
      setMode((m) => (m.kind === "trigger" ? CLOSED : m));
      return;
    }
    const between = before.slice(idx + 2);
    // Между `{{` и каретом ничего «закрывающего» не должно быть.
    if (/[\s}{]/.test(between)) {
      setMode((m) => (m.kind === "trigger" ? CLOSED : m));
      return;
    }
    setMode({ kind: "trigger", start: idx, filter: between });
    setHighlight(0);
  }, []);

  const filtered = useMemo(() => {
    if (mode.kind === "closed") return [];
    if (mode.kind === "picker") return props.variables;
    const f = mode.filter.toLowerCase();
    return props.variables.filter(
      (v) =>
        v.key.toLowerCase().includes(f) ||
        (v.label && v.label.toLowerCase().includes(f)),
    );
  }, [mode, props.variables]);

  const safeHighlight = Math.min(highlight, Math.max(filtered.length - 1, 0));

  const insert = useCallback(
    (key: string) => {
      const ta = ref.current;
      if (!ta) return;
      const caret = ta.selectionStart;
      const start = mode.kind === "trigger" ? mode.start : caret;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(caret);
      const inserted = `{{${key}}}`;
      props.onChange(before + inserted + after);
      const nextCaret = before.length + inserted.length;
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(nextCaret, nextCaret);
      });
      setMode(CLOSED);
    },
    [mode, props],
  );

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    props.onChange(e.target.value);
    // rAF — чтобы selectionStart успел обновиться после re-render'а.
    requestAnimationFrame(recompute);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mode.kind === "closed" || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(filtered[safeHighlight]!.key);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setMode(CLOSED);
    }
  };

  return (
    <div className={"relative " + (props.className ?? "")}>
      <textarea
        ref={ref}
        value={props.value}
        rows={props.rows ?? 4}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={recompute}
        onClick={recompute}
        onBlur={() => {
          // Задержка — иначе клик по `<li>` в popover'е не успевает
          // зарегистрироваться (focus уходит, popover unmount раньше).
          setTimeout(() => setMode(CLOSED), 120);
        }}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 pr-8 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <button
        type="button"
        onMouseDown={(e) => {
          // Не теряем фокус textarea — иначе onBlur закроет popover.
          e.preventDefault();
          setMode((m) => (m.kind === "picker" ? CLOSED : { kind: "picker" }));
        }}
        title="Вставить переменную"
        className="absolute right-1.5 top-1.5 rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      >
        <Braces size={14} />
      </button>
      {mode.kind !== "closed" && filtered.length > 0 && (
        <VariablesMenu
          options={filtered}
          highlight={safeHighlight}
          onHover={setHighlight}
          onPick={insert}
          textareaRef={ref}
        />
      )}
    </div>
  );
}

function VariablesMenu(props: {
  options: VariableOption[];
  highlight: number;
  onHover: (i: number) => void;
  onPick: (key: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const ta = props.textareaRef.current;
      if (!ta) return;
      const r = ta.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    // capture:true — ловим scroll внутренних контейнеров (модалки,
    // overflow-сайдбары), не только window.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [props.textareaRef]);

  if (!rect) return null;

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: rect.left,
        top: rect.top,
        width: rect.width,
      }}
      className="z-[60] max-h-60 overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      <ul className="py-1 text-sm">
        {props.options.map((opt, i) => (
          <li
            key={opt.key}
            onMouseEnter={() => props.onHover(i)}
            onClick={() => props.onPick(opt.key)}
            className={
              "flex cursor-pointer items-center justify-between px-3 py-1.5 " +
              (i === props.highlight ? "bg-emerald-50 text-emerald-900" : "")
            }
          >
            <span className="font-mono text-xs text-zinc-700">{`{{${opt.key}}}`}</span>
            <span className="ml-3 truncate text-xs text-zinc-500">
              {opt.label ?? ""}
            </span>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

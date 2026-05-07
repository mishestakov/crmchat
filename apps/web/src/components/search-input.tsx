import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";

// Локальный state, чтобы во время набора не дёргать query на каждой букве
// (debounce 500ms). Enter форсирует, Escape сбрасывает к внешнему value.
export function SearchInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [local, setLocal] = useState(props.value);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setLocal(props.value);
  }, [props.value]);

  useEffect(() => {
    if (local === props.value) return;
    const t = setTimeout(() => onChangeRef.current(local), 500);
    return () => clearTimeout(t);
  }, [local, props.value]);

  return (
    <div className="relative">
      <SearchIcon
        size={14}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
      />
      <input
        ref={inputRef}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onChangeRef.current(local);
          else if (e.key === "Escape") setLocal(props.value);
        }}
        placeholder={props.placeholder}
        className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

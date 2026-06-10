import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useEscapeKey } from "../lib/hooks";

// Единый каркас правого оверлея: backdrop + aside + Esc (стек в useEscapeKey,
// закрывается верхний) + опциональная шапка с крестиком. До унификации каркас
// был скопирован в 4 дроверах с расходящимися закрытиями («← Закрыть» vs X)
// и max-w — фидбек Юли 10.06.26 п. 15.
export function Drawer(props: {
  width: number; // px; на узких экранах ограничен max-w-[95vw]
  onClose: () => void;
  // Передан (хоть null) → стандартная шапка: title слева, X справа.
  // Не передан → шапку рисуют children (например, у чата X в своей шапке).
  title?: ReactNode;
  children: ReactNode;
}) {
  useEscapeKey(props.onClose);
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-zinc-900/20"
        onClick={props.onClose}
      />
      <aside
        style={{ width: props.width }}
        className="fixed bottom-0 right-0 top-0 z-50 flex max-w-[95vw] flex-col bg-white shadow-2xl"
      >
        {props.title !== undefined && (
          <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
            <div className="min-w-0 flex-1">{props.title}</div>
            <button
              type="button"
              onClick={props.onClose}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {props.children}
      </aside>
    </>
  );
}

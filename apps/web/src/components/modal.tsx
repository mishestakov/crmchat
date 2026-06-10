import { type ReactNode } from "react";
import { X } from "lucide-react";
import { useEscapeKey } from "../lib/hooks";

// Backdrop + центрирование + ESC-закрытие. Variant 'sheet' — на мобильном
// прилипает к низу со скруглением сверху (preview/delete-confirm на
// телефоне). 'plain' — всегда по центру (аналитика, редактор стадий).

type ModalProps = {
  onClose: () => void;
  children: ReactNode;
  variant?: "sheet" | "plain";
  size?: "sm" | "md" | "lg";
  zIndex?: number;
  // Задан → стандартная шапка «заголовок + X». Без него children рисуют свою.
  title?: string;
};

const SIZE_CLASS = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

export function Modal({
  onClose,
  children,
  variant = "plain",
  size = "sm",
  zIndex = 50,
  title,
}: ModalProps) {
  useEscapeKey(onClose);
  const wrap =
    variant === "sheet"
      ? "fixed inset-0 flex items-end justify-center sm:items-center"
      : "fixed inset-0 flex items-center justify-center p-4";
  const inner =
    variant === "sheet"
      ? `relative w-full ${SIZE_CLASS[size]} rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl`
      : `relative w-full ${SIZE_CLASS[size]} rounded-2xl bg-white p-5 shadow-xl`;
  return (
    <div className={wrap} style={{ zIndex }}>
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-zinc-900/30"
      />
      <div className={inner}>
        {title !== undefined && (
          <div className="mb-4 flex items-center justify-between">
            <div className="text-base font-semibold text-zinc-900">{title}</div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

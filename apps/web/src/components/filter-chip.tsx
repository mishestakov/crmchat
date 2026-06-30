import type { ReactNode } from "react";

// Общий фильтр-чип: площадки (channels), сети РКН (rkn), системы/платформы
// «Каналы Яндекса» (platform-active). icon — опционально (inline-flex и gap
// безвредны без иконки).
export function FilterChip({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors " +
        (active
          ? "bg-zinc-900 text-white ring-zinc-900"
          : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50")
      }
    >
      {icon}
      {label}
    </button>
  );
}

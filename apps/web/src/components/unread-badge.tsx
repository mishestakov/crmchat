// Визуальный бейдж непрочитанных. Использовать там же где раньше дублировали
// `rounded-full bg-emerald-500 ...` руками: контакты, канбан-карточки,
// проекты в tree-навигации. Clickability — на стороне вызывающего (оборачивают
// в button если надо).

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold leading-5 text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

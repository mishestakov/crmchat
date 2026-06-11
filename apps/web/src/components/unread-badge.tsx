// Визуальный бейдж непрочитанных. Использовать там же где раньше дублировали
// `rounded-full bg-emerald-500 ...` руками: контакты, канбан-карточки,
// проекты в tree-навигации. Clickability — на стороне вызывающего (оборачивают
// в button если надо).

// dot — ручная пометка «непрочитано» (contacts.marked_unread): при count=0
// рисуем точку без цифры; счётчик с цифрой всегда приоритетнее точки.
export function UnreadBadge({ count, dot }: { count: number; dot?: boolean }) {
  if (count > 0) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-xs font-semibold leading-5 text-white">
        {count > 99 ? "99+" : count}
      </span>
    );
  }
  if (dot) {
    return (
      <span className="block h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
    );
  }
  return null;
}

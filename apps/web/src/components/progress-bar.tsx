// Тонкая полоса прогресса — третий повтор двухдивного бара (готовность
// контактов и сбор метрик в кампании, синк РКН) вынесен в одну точку.
// Ширину контейнера задаёт вызывающий через className.
export function ProgressBar(props: {
  pct: number;
  className?: string;
  // Цвета отдельными пропсами (не через className): два bg-* класса одной
  // специфичности соревновались бы порядком в сгенерированном CSS.
  trackClass?: string;
  fillClass?: string;
}) {
  const pct = Math.min(100, Math.max(0, props.pct));
  return (
    <div
      className={
        "h-1.5 overflow-hidden rounded-full " +
        (props.trackClass ?? "bg-zinc-200") +
        " " +
        (props.className ?? "")
      }
    >
      <div
        className={
          "h-full rounded-full transition-all " +
          (props.fillClass ?? "bg-emerald-500")
        }
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

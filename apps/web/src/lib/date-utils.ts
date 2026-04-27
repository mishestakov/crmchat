// Общие date/number utility'и. Раньше дублировались в нескольких файлах.

export function pluralize(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatDateTime(iso: string | Date): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "5 мин назад" / "через 2 ч". opts.future — будущее время.
export function formatRelative(
  iso: string,
  opts?: { future?: boolean },
): string {
  if (!iso) return "—";
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = opts?.future
    ? Math.max(1, Math.floor((t - now) / 1000))
    : Math.max(1, Math.floor((now - t) / 1000));
  const suffix = opts?.future ? "" : " назад";
  const prefix = opts?.future ? "через " : "";
  if (diffSec < 60) return `${prefix}${diffSec} сек${suffix}`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${prefix}${min} мин${suffix}`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${prefix}${hr} ч${suffix}`;
  const day = Math.floor(hr / 24);
  return `${prefix}${day} дн${suffix}`;
}

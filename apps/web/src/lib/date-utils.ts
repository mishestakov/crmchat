// Общие date/number utility'и. Опираемся на Intl: локализация + склонения
// делает рантайм, не мы.

const pluralRules = new Intl.PluralRules("ru");

export function pluralize(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  switch (pluralRules.select(n)) {
    case "one":
      return one;
    case "few":
      return few;
    default:
      return many;
  }
}

const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// «Имя · 5 июн.» — подпись автора памятки (NoteStrip).
export function formatNoteByline(n: {
  byName: string | null;
  at: string;
}): string {
  const d = new Date(n.at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
  return `${n.byName ?? "—"} · ${d}`;
}

export function formatDateTime(iso: string | Date): string {
  if (!iso) return "";
  return dateTimeFormat.format(typeof iso === "string" ? new Date(iso) : iso);
}

const hhmmFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatHHMM(iso: string | Date): string {
  if (!iso) return "";
  return hhmmFormat.format(typeof iso === "string" ? new Date(iso) : iso);
}

// Ключ суток в локальном времени — для группировки сообщений по дням в ленте.
export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const dayMonthFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const dayMonthYearFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

// Заголовок-разделитель дня в ленте чата: «Сегодня» / «Вчера» / «15 июня» /
// «15 июня 2024 г.» (год добавляем только если не текущий).
export function formatDaySeparator(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return "Вчера";
  return d.getFullYear() === now.getFullYear()
    ? dayMonthFormat.format(d)
    : dayMonthYearFormat.format(d);
}

// Прошлое для sent/read/replied: «только что» / «N мин. назад» / «N ч. назад»
// / абс дата+время после 8 часов. Без секунд — они визуально шумят.
export function formatPastRelative(iso: string | Date): string {
  const d = Date.now() - new Date(iso).getTime();
  return d < 60_000 ? "только что"
    : d < 3_600_000 ? `${Math.floor(d / 60_000)} мин. назад`
    : d < 28_800_000 ? `${Math.floor(d / 3_600_000)} ч. назад`
    : formatDateTime(iso);
}

const relativeFormat = new Intl.RelativeTimeFormat("ru", { style: "short" });

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; sec: number }[] = [
  { unit: "day", sec: 86_400 },
  { unit: "hour", sec: 3_600 },
  { unit: "minute", sec: 60 },
  { unit: "second", sec: 1 },
];

export function formatRelative(
  iso: string,
  opts?: { future?: boolean },
): string {
  if (!iso) return "—";
  const diffSec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  const signed = opts?.future ? Math.max(1, diffSec) : Math.min(-1, diffSec);
  const abs = Math.abs(signed);
  // abs >= 1 (см. Math.max/min выше) → последний элемент {sec:1} всегда матчит.
  const { unit, sec } = RELATIVE_UNITS.find((u) => abs >= u.sec)!;
  return relativeFormat.format(Math.trunc(signed / sec), unit);
}

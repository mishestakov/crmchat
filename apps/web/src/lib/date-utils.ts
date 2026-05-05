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

export function formatDateTime(iso: string | Date): string {
  if (!iso) return "";
  return dateTimeFormat.format(typeof iso === "string" ? new Date(iso) : iso);
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

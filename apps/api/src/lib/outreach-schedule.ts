import type { OutreachSchedule } from "../db/schema";

// Проверки расписания для outreach-воркера. Чистые функции от now → ответ.
// Используют Intl.DateTimeFormat с явной timezone — это даёт DST-safe вычисления
// без сторонних библиотек (date-fns/luxon мы не подключали).

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

// Парсит «компоненты now в указанной tz» в одно прохождение через Intl.
// `weekday` возвращаем в нашей нотации (mon/tue/...), `hour` 0..23.
function tzParts(now: Date, tz: string) {
  // en-US с hour12:false → hourCycle h23 (0..23). 'short' weekday → "Mon", "Tue" и т.п.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const lookup: Record<string, string> = {};
  for (const p of parts) lookup[p.type] = p.value;
  // Intl с hour12:false иногда отдаёт "24" вместо "00" в полночь — нормализуем.
  const hourRaw = parseInt(lookup.hour ?? "0", 10);
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const weekday = (lookup.weekday ?? "Mon").toLowerCase().slice(0, 3) as WeekdayKey;
  return {
    weekday,
    hour,
    minute: parseInt(lookup.minute ?? "0", 10),
    second: parseInt(lookup.second ?? "0", 10),
  };
}

export function isNowInWindow(
  schedule: OutreachSchedule,
  now: Date,
): boolean {
  const { weekday, hour } = tzParts(now, schedule.timezone);
  const day = schedule.dailySchedule[weekday];
  if (!day) return false;
  return hour >= day.startHour && hour < day.endHour;
}

// Возвращает Date, соответствующий началу «сегодняшних суток» в указанной tz,
// в виде UTC-момента. DST-safe: вычитаем фактически прошедшие сегодня
// часы/минуты/секунды (а не строим дату из year/month/day, что ломается на
// DST-переходах).
export function startOfDayInTz(now: Date, tz: string): Date {
  const { hour, minute, second } = tzParts(now, tz);
  const elapsedMs = ((hour * 60 + minute) * 60 + second) * 1000;
  return new Date(now.getTime() - elapsedMs);
}

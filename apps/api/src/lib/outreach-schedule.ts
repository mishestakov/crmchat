import type { OutreachSchedule } from "../db/schema.ts";

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

// PEER_FLOOD = временный антиспам TG на письма новым (не бан). Пауза аккаунта
// до начала следующего дня в tz воркспейса (окно расписания догейтит до
// рабочего часа). Один источник правды для воркера (sync-throw из sendMessage)
// и листенера (async updateMessageSendFailed — основной путь).
export const PEER_FLOOD_COOLDOWN_REASON =
  "TG ограничил письма новым (PEER_FLOOD) — пауза до завтра";

export function peerFloodCooldownUntil(tz: string): Date {
  return startOfDayInTz(new Date(Date.now() + 24 * 60 * 60 * 1000), tz);
}

// Ближайший момент >= candidate, попадающий в рабочее окно расписания. Если
// candidate уже внутри окна — возвращаем как есть; иначе — начало следующего
// разрешённого окна (позже сегодня либо в ближайший рабочий день). Назначение:
// сделать send_at честным — чтобы в БД/UI лежало реальное время ближайшей
// попытки, а не «сырое» время, которое воркер всё равно догейтит окном (классика
// — PEER_FLOOD ставил send_at на 00:00, а реальная попытка — после 09:00).
// DST-safe: начало окна доводим до настенного часа через tzParts (фикс-смещение
// от полуночи промахнулось бы на час, если ночью был DST-переход). Москва без
// DST → коррекция no-op, но функция остаётся верной для DST-tz.
export function nextAllowedSendAt(
  schedule: OutreachSchedule,
  candidate: Date,
): Date {
  if (isNowInWindow(schedule, candidate)) return candidate;
  // Идём по дням от дня candidate, ищем первое окно, открывающееся в момент
  // >= candidate. До 8 шагов; расписание без рабочих дней → возвращаем как есть.
  let probe = candidate;
  for (let i = 0; i < 8; i++) {
    const { weekday } = tzParts(probe, schedule.timezone);
    const dayStart = startOfDayInTz(probe, schedule.timezone);
    const day = schedule.dailySchedule[weekday];
    if (day) {
      // Фикс-смещение от 00:00 даёт ровно startHour только без DST-перехода
      // между полночью и окном; иначе настенный час уедет на ±1 — доводим.
      let start = new Date(dayStart.getTime() + day.startHour * 60 * 60 * 1000);
      const startHour = tzParts(start, schedule.timezone).hour;
      if (startHour !== day.startHour) {
        start = new Date(
          start.getTime() + (day.startHour - startHour) * 60 * 60 * 1000,
        );
      }
      if (start.getTime() >= candidate.getTime()) return start;
    }
    // Следующий день: +36ч от начала суток (DST-safe буфер) → снап к 00:00.
    probe = startOfDayInTz(
      new Date(dayStart.getTime() + 36 * 60 * 60 * 1000),
      schedule.timezone,
    );
  }
  return candidate;
}

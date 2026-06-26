// Вычисляемая «здоровье»-подсветка лида (§1.4 specs/bd-autodogon.md).
// Чистая функция поверх данных, которые уже отдаёт /leads — без отдельных
// полей-цветов в БД. Держим логику здесь, а не в компонентах: канбан и список
// читают один результат.
//
// Бейдж карточки — ровно одно из двух, по тому, ВЗВЕДЕНА ли пиналка:
//   • пиналка идёт  → «пиналка sent/total» (прогресс текущего захода);
//   • пиналка выкл  → «затихло N дней» (дней с последнего сообщения в треде),
//     чтобы менеджер видел протухающие карточки и решал — включить пиналку или
//     написать. 3+ дней застоя → красный, до 3 — обычный.
// Прогресс N/total — по ТЕКУЩЕМУ заходу (последний dunning_round): холодный
// авто-догон — round 0, ручной взвод (этап C) пишет 1,2…. Так бейдж не
// накапливает прошлые серии.

const DAY_MS = 24 * 60 * 60 * 1000;

// Порог застоя: затих STALE_DAYS+ дней назад → красный.
const STALE_DAYS = 3;

// Финальный оффер («вы выбраны») живёт на этом idx — отдельный bulk-механизм, не
// пиналка. Исключаем его из прогресса пиналки (совпадает с FINAL_OFFER_MSG_IDX
// на бэке).
const FINAL_OFFER_IDX = 1000;

// Максимальный timestamp из набора ISO-строк (null/пустые/невалидные
// игнорируются); 0 — если дат нет. Удобно для «последней активности» из разных
// источников. NaN от битой даты отбрасываем, чтобы он не «съел» Math.max.
const latestTs = (dates: (string | null | undefined)[]): number =>
  dates.reduce((acc, d) => {
    const t = d ? Date.parse(d) : NaN;
    return Number.isNaN(t) ? acc : Math.max(acc, t);
  }, 0);

export type LeadHealthInput = {
  messages: {
    messageIdx: number;
    dunningRound: number;
    status: string;
    sentAt: string | null;
  }[];
  // Время последнего ВХОДЯЩЕГО от блогера (contacts.last_message_at — его двигает
  // только listener на входящем; наши отправки его НЕ трогают). null — блогер не
  // писал (или контакта ещё нет).
  lastMessageAt: string | null;
};

export type LeadHealth = {
  // Подсветка карточки: красный — застой 3+ дней при выключенной пиналке; null —
  // нейтраль (пиналка идёт, либо коммуникация свежая).
  color: "red" | null;
  // Взведена ли пиналка (есть pending-пинг) — для кнопки вкл/выкл в чате.
  active: boolean;
  // Что рисуем в строке-бейдже карточки; null — показывать нечего.
  badge:
    | { kind: "dunning"; sent: number; total: number }
    | { kind: "stale"; days: number }
    | null;
};

export function getLeadHealth(
  lead: LeadHealthInput,
  now: number = Date.now(),
): LeadHealth {
  // Опенер — idx 0; пиналка — пинги idx 1..N (финальный оффер idx 1000 — не пинг).
  const followups = lead.messages.filter(
    (m) => m.messageIdx > 0 && m.messageIdx < FINAL_OFFER_IDX,
  );
  // «Пиналка идёт» — есть запланированный, ещё не отправленный пинг (только один
  // заход взведён одновременно).
  const active = followups.some((m) => m.status === "pending");

  // Пиналка взведена → бейдж прогресса серии по текущему заходу. Карточка
  // нейтральная: ей занимается машина, привлекать внимание менеджера не нужно.
  if (active) {
    const latestRound = followups.reduce(
      (m, f) => Math.max(m, f.dunningRound),
      0,
    );
    const series = followups.filter((m) => m.dunningRound === latestRound);
    const sent = series.filter((m) => m.status === "sent").length;
    return {
      color: null,
      active: true,
      badge: { kind: "dunning", sent, total: series.length },
    };
  }

  // Пиналка выключена → считаем застой. Активность = max(наши отправки, последнее
  // входящее): «последнее сообщение в треде» в любую сторону. Ловит и «он молчит
  // нам», и «он написал, а мы не отвечаем».
  const lastActivity = Math.max(
    latestTs(lead.messages.map((m) => m.sentAt)),
    latestTs([lead.lastMessageAt]),
  );
  if (lastActivity === 0) return { color: null, active: false, badge: null };

  const days = Math.floor((now - lastActivity) / DAY_MS);
  const color = days >= STALE_DAYS ? "red" : null;
  // До суток молчания не флагуем — карточка свежая, бейдж только зашумит.
  const badge = days >= 1 ? { kind: "stale" as const, days } : null;
  return { color, active: false, badge };
}

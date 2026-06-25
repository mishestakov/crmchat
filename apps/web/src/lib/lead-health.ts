// Вычисляемая «здоровье»-подсветка лида (§1.4 specs/bd-autodogon.md).
// Чистая функция поверх данных, которые уже отдаёт /leads — без отдельных
// полей-цветов в БД. Держим логику здесь, а не в компонентах: карточка лишь
// читает результат (canбан + список используют одну функцию).
//
// Бейдж N/total — по ТЕКУЩЕМУ заходу (последний dunning_round): холодный
// авто-догон — это round 0, ручной взвод (этап C) пишет 1,2…. Так бейдж не
// накапливает прошлые серии. КРАСНЫЙ ортогонален счёту серий — сравнивает
// времена (последний пинг vs последнее входящее), переигрывается на новом взводе.

const STALE_MS = 24 * 60 * 60 * 1000;

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
  // писал (или контакта ещё нет). Сравнение с временем последнего пинга и даёт
  // «ответил ли он на серию» — устойчиво к повторным сериям, без вечного флага
  // repliedAt (тот = «когда-либо ответил», для этого негоден).
  lastMessageAt: string | null;
};

export type LeadHealth = {
  // null — нейтральная карточка (машина в работе либо свежий контакт).
  color: "yellow" | "red" | null;
  // Прогресс пиналки для бейджа `N/total`; null — пингов в цепочке нет.
  dunning: { sent: number; total: number; active: boolean } | null;
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
  // заход может быть взведён одновременно).
  const active = followups.some((m) => m.status === "pending");
  // Бейдж — по текущему заходу (последний dunning_round), без накопления серий.
  const latestRound = followups.reduce((m, f) => Math.max(m, f.dunningRound), 0);
  const series = followups.filter((m) => m.dunningRound === latestRound);
  const total = series.length;
  const sent = series.filter((m) => m.status === "sent").length;
  const dunning = total > 0 ? { sent, total, active } : null;

  // Время последнего входящего от блогера и время последнего отправленного пинга.
  const lastInbound = latestTs([lead.lastMessageAt]);
  const lastSentPing = latestTs(
    followups.filter((m) => m.status === "sent").map((m) => m.sentAt),
  );

  // Порядок проверки (§1.4): красный → пиналка идёт → < суток → жёлтый.

  // Красный: серия выкл (нет pending), пинг был отправлен, и блогер НЕ написал
  // ПОСЛЕ последнего пинга. Сравниваем времена, а не булев «когда-либо ответил»
  // (repliedAt) — поэтому корректно переигрывается на повторных сериях: новый
  // взвод даёт новый lastSentPing, и если на него снова не ответили — снова
  // красный, даже если блогер отвечал в прошлой серии.
  if (!active && lastSentPing > 0 && lastInbound < lastSentPing) {
    return { color: "red", dunning };
  }

  // Жёлтый: пиналка выкл и > суток с последней активности в треде. Активность —
  // max(наши отправки, последнее входящее): ловит и «он молчит нам», и «он
  // написал, а мы сутки не отвечаем».
  if (!active) {
    const lastOutbound = latestTs(lead.messages.map((m) => m.sentAt));
    const lastActivity = Math.max(lastOutbound, lastInbound);
    if (lastActivity > 0 && now - lastActivity > STALE_MS) {
      return { color: "yellow", dunning };
    }
  }

  return { color: null, dunning };
}

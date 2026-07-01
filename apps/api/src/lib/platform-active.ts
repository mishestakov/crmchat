import { sql } from "drizzle-orm";
import { channelMatchCandidatesSqlText } from "./channel-match-keys.ts";

// «Работает на платформе»: канал крутится у нас в CPC/CPA (суточный синк с YT
// в platform_active_channels). Симметричный матч по массиву отпечатков
// (pac.match_key && кандидаты канала), поэтому канал, известный пока только по
// @username (external_id появляется лишь после открытия карточки), тоже
// находится. Это ИНФОРМ-сигнал для бейджа, НЕ гейт: аутрич НЕ блокируем
// (CPC/CPA-сигнал ненадёжен — админ мог смениться, у одного админа часть
// каналов активна), менеджер решает сам. Параметризовано алиасом.
// Форма запроса важна для производительности. Наивное `pac.match_key &&
// candidates` семантически верно, но планировщик на нём выбирает seqscan по
// 134k строк pac НА КАЖДЫЙ лид (проверено на проде: 25 лидов → 3.3 s, 50 →
// 12 s) — GIN-индекс с runtime-массивом в правой части `&&` он не берёт.
// Разворачиваем кандидатов в строки и проверяем каждый одноэлементным `@>`
// (pac.match_key содержит кандидата) — такую проверку GIN обслуживает точечно
// (те же 25/50 лидов → 1.3/3.4 ms). Семантика та же: пересечение массивов ⇔
// существует общий (не-NULL) элемент.
export function channelActiveExistsSqlText(alias: string): string {
  return `EXISTS (
  SELECT 1
  FROM unnest(${channelMatchCandidatesSqlText(alias)}) AS candidate(match_key)
  WHERE candidate.match_key IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM platform_active_channels pac
      WHERE pac.match_key @> ARRAY[candidate.match_key]
    ))`;
}

// «Канал работает у нас» — информ-бейдж в списках (alias channels).
export const channelAlreadyWorkingSql = sql<boolean>`${sql.raw(
  channelActiveExistsSqlText("channels"),
)}`;

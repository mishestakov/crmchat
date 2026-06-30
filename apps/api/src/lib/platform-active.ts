import { sql } from "drizzle-orm";
import { channelMatchCandidatesSqlText } from "./channel-match-keys.ts";

// «Работает на платформе»: канал крутится у нас в CPC/CPA (суточный синк с YT
// в platform_active_channels). Симметричный матч по массиву отпечатков
// (pac.match_key && кандидаты канала), поэтому канал, известный пока только по
// @username (external_id появляется лишь после открытия карточки), тоже
// находится. Это ИНФОРМ-сигнал для бейджа, НЕ гейт: аутрич НЕ блокируем
// (CPC/CPA-сигнал ненадёжен — админ мог смениться, у одного админа часть
// каналов активна), менеджер решает сам. Параметризовано алиасом.
export function channelActiveExistsSqlText(alias: string): string {
  return `EXISTS (
  SELECT 1 FROM platform_active_channels pac
  WHERE pac.match_key && ${channelMatchCandidatesSqlText(alias)})`;
}

// «Канал работает у нас» — информ-бейдж в списках (alias channels).
export const channelAlreadyWorkingSql = sql<boolean>`${sql.raw(
  channelActiveExistsSqlText("channels"),
)}`;

import { sql } from "drizzle-orm";
import { channelMatchCandidatesSqlText } from "./channel-match-keys.ts";

// Гейт «уже работает на платформе»: канал крутится у нас в CPC/CPA (суточный
// синк выгрузки с YT в platform_active_channels). Матч channels ↔
// platform_active_channels по тем же кандидатам ключей, что РКН — нет записи =
// не работает у нас. Параметризовано алиасом (channels / raw-подзапросы).
export function channelActiveExistsSqlText(alias: string): string {
  return `EXISTS (
  SELECT 1 FROM platform_active_channels pac
  WHERE pac.match_key = ANY (${channelMatchCandidatesSqlText(alias)}))`;
}

// «Канал уже работает у нас» — для гейта/бейджа в списках (alias channels).
export const channelAlreadyWorkingSql = sql<boolean>`${sql.raw(
  channelActiveExistsSqlText("channels"),
)}`;

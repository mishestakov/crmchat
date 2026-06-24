import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { outreachAccountEvents, outreachAccounts } from "../db/schema.ts";
import { errMsg } from "./errors.ts";

// Журнал событий здоровья аккаунта (outreach_account_events). Кормит счётчик
// отправок и график страйков. Отдельный модуль без других lib-зависимостей —
// чтобы звать из worker/listener/quick-send/account-client без циклов импорта
// (account-client ↔ listener уже связаны).
export type AccountEventType =
  | "cold_send"
  | "peer_flood"
  | "flood_wait"
  | "banned"
  | "unauthorized"
  | "manual_rest"
  | "resume";

// workspace_id берём подзапросом из самой account-строки — helper остаётся
// (accountId, type, detail?), вызывающим не надо тащить workspaceId. Запись
// best-effort: журнал не должен ронять отправку или смену состояния, поэтому
// ошибку глотаем в warn.
export async function recordAccountEvent(
  accountId: string,
  type: AccountEventType,
  detail?: string,
): Promise<void> {
  try {
    await db.insert(outreachAccountEvents).values({
      workspaceId: sql`(select ${outreachAccounts.workspaceId} from ${outreachAccounts} where ${outreachAccounts.id} = ${accountId})`,
      accountId,
      type,
      detail: detail ?? null,
    });
  } catch (e) {
    console.warn(`[recordAccountEvent] ${type} for ${accountId}:`, errMsg(e));
  }
}

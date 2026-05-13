import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { projectItems } from "../db/schema.ts";
import { errMsg } from "./errors.ts";
import type { TdClient } from "./tdlib/index.ts";

// Lazy-резолв tg_user_id для лида project_items: импорт CSV в проект сохранил
// username, но если контакта с тем же @ в воркспейсе ещё не было — pre-resolve
// sticky (10.3) ничего не нашёл и lead.tg_user_id остался null. До первого
// исходящего worker'а quick-send не мог открыть peer'а.
//
// Симметрия с ensureContactTgUserId (см. lib/ensure-tg-user-id.ts):
// searchPublicChat тащит TG-чат по username и даёт user_id; сохраняем в
// project_items.tg_user_id. Следующий вызов идёт по короткому пути.
export async function ensureLeadTgUserId(args: {
  leadId: string;
  username: string | null;
  tgUserId: string | null;
  client: TdClient;
}): Promise<string | null> {
  if (args.tgUserId) return args.tgUserId;
  if (!args.username) return null;
  const username = args.username.replace(/^@/, "").trim();
  if (!username) return null;

  let chat: { type: { _: string; user_id?: number } };
  try {
    chat = (await args.client.invoke({
      _: "searchPublicChat",
      username,
    } as never)) as { type: { _: string; user_id?: number } };
  } catch (e) {
    console.error(
      `[ensure-lead-tg-user-id] searchPublicChat ${username}:`,
      errMsg(e),
    );
    return null;
  }
  if (chat.type._ !== "chatTypePrivate" || !chat.type.user_id) return null;
  const tgUserId = String(chat.type.user_id);

  await db
    .update(projectItems)
    .set({ tgUserId })
    .where(eq(projectItems.id, args.leadId));

  return tgUserId;
}

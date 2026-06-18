import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { contacts } from "../db/schema.ts";
import { errMsg } from "./errors.ts";
import { syncTgUserNow } from "./tg-replicator.ts";
import type { TdClient } from "./tdlib/index.ts";

// Lazy-резолв tg_user_id для контакта: заведён по @ без последующих
// отправок (channels admin smart-stub / bulk-добавление каналов) → contact
// живёт без id и quick-send / chat-history его не открывают. searchPublicChat тащит
// TG-чат по username и даёт user_id; сохраняем в properties.tg_user_id
// (jsonb-merge) — следующий вызов уже идёт по короткому пути.
//
// Возвращает tg_user_id (string) либо null если username отсутствует или
// TG не нашёл такого юзера (приватный без публичного @, bot, deleted).
export async function ensureContactTgUserId(args: {
  workspaceId: string;
  contactId: string;
  properties: Record<string, unknown>;
  client: TdClient;
}): Promise<string | null> {
  const v = args.properties;
  if (typeof v.tg_user_id === "string") return v.tg_user_id;
  const usernameRaw =
    typeof v.telegram_username === "string" ? v.telegram_username : null;
  if (!usernameRaw) return null;
  const username = usernameRaw.replace(/^@/, "").trim();
  if (!username) return null;

  let chat: { type: { _: string; user_id?: number } };
  try {
    chat = (await args.client.invoke({
      _: "searchPublicChat",
      username,
    } as never)) as { type: { _: string; user_id?: number } };
  } catch (e) {
    console.error(
      `[ensure-tg-user-id] searchPublicChat ${username}:`,
      errMsg(e),
    );
    return null;
  }
  if (chat.type._ !== "chatTypePrivate" || !chat.type.user_id) return null;
  const tgUserId = String(chat.type.user_id);

  await db
    .update(contacts)
    .set({
      properties: sql`${contacts.properties} || ${JSON.stringify({ tg_user_id: tgUserId })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, args.contactId));

  // Раз уж познакомились с юзером — сразу записываем его тип (бот/человек) в
  // tg_users синхронно. Иначе эту строку дописывает асинхронный репликатор
  // (updateUser → flush), и читатели tg_users.is_bot сразу после резолва
  // (chat-history peerIsBot, bot-start, фильтр ботов в рассылке) видят пустоту.
  // Не критично для самого резолва: ошибка getUser не должна ронять выдачу
  // tg_user_id — логируем и идём дальше.
  await syncTgUserNow(args.client, tgUserId).catch((e) => {
    console.error(`[ensure-tg-user-id] syncTgUserNow ${tgUserId}:`, errMsg(e));
  });

  return tgUserId;
}

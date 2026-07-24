import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/client.ts";
import { contacts, outreachAccounts, tgUsers } from "../db/schema.ts";
import { errMsg } from "./errors.ts";
import {
  getOutreachWorkerClient,
  parseFloodWaitSeconds,
} from "./outreach-account-client.ts";
import { applyChatUnread } from "./outreach-listener.ts";
import { syncTgUserNow } from "./tg-replicator.ts";
import type { TdClient } from "./tdlib/index.ts";

// FLOOD_WAIT-кулдаун поиска per-АККАУНТ (in-memory; рестарт процесса теряет —
// приемлемо, один запрос и снова закэшено). searchPublicChat жёстко
// лимитирован TG; без кэша каждый открытый дровер заново долбил флуднутый
// аккаунт (продлевая пенальти) и получал врущее «@username не найден». Пока
// кулдаун тикает — не ходим в TG вовсе, отдаём честный 429 с оценкой времени.
// Ключ — accountId (не клиент): переживает пересоздание клиента и читается
// страницей аккаунтов (бейдж «поиск ограничен», см. getSearchFloodUntil).
const searchFloodUntil = new Map<string, number>();

// Для UI (список аккаунтов): активный search-кулдаун аккаунта или null.
// Истёкшие записи попутно чистим (Map иначе копил бы их вечно).
export function getSearchFloodUntil(accountId: string): number | null {
  const until = searchFloodUntil.get(accountId);
  if (until === undefined) return null;
  if (Date.now() >= until) {
    searchFloodUntil.delete(accountId);
    return null;
  }
  return until;
}

// Общий реестр search-флуда для ЛЮБЫХ searchPublicChat-путей (контакты здесь,
// канальный sync в routes/channels/telegram.ts): один аккаунт — один бюджет
// поиска, где бы он ни тратился. Запись сюда зажигает и бейдж «поиск огр.».
export function markSearchFlooded(accountId: string, waitSec: number): number {
  const until = Date.now() + waitSec * 1000;
  searchFloodUntil.set(accountId, until);
  return until;
}

// «Знакомство» аккаунта с пиром по @username (flood-aware searchPublicChat).
// Нужно send-путям после DB-first резолва: id известен из реплики, но TDLib
// ИМЕННО ЭТОГО аккаунта не имеет access_hash пира — sendMessage падает
// «Chat not found». Один успешный вызов чинит навсегда (access_hash оседает
// в локальной базе аккаунта). false — не смогли (флуд/не найден): вызывающий
// пробрасывает исходную ошибку.
export async function acquaintWithPeer(
  client: TdClient,
  accountId: string,
  username: string,
): Promise<boolean> {
  const u = username.replace(/^@/, "").trim();
  if (!u) return false;
  if (getSearchFloodUntil(accountId)) return false;
  try {
    await client.invoke({ _: "searchPublicChat", username: u } as never);
    return true;
  } catch (e) {
    const msg = errMsg(e);
    const waitSec = parseFloodWaitSeconds(msg);
    if (waitSec) markSearchFlooded(accountId, waitSec);
    console.error(`[ensure-tg-user-id] acquaint ${u}:`, msg);
    return false;
  }
}

function throwSearchFlooded(untilMs: number): never {
  // Честная оценка: короткие пенальти (частый случай у searchPublicChat) — в
  // минутах, длинные — в часах; «~1ч» при реальных 60с гнал юзера прочь зря.
  const ms = untilMs - Date.now();
  const human =
    ms < 3_600_000
      ? `~${Math.max(1, Math.round(ms / 60_000))} мин`
      : `~${Math.round(ms / 3_600_000)} ч`;
  throw new HTTPException(429, {
    message: `TG ограничил поиск юзернеймов с этого аккаунта (${human}) — откройте чат позже или с другого аккаунта`,
  });
}

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
  // Для флуд-кулдауна (ключ кэша) и бейджа на странице аккаунтов.
  accountId: string;
}): Promise<string | null> {
  const v = args.properties;
  if (typeof v.tg_user_id === "string") return v.tg_user_id;
  const usernameRaw =
    typeof v.telegram_username === "string" ? v.telegram_username : null;
  if (!usernameRaw) return null;
  const username = usernameRaw.replace(/^@/, "").trim();
  if (!username) return null;

  // Сначала — БЕСПЛАТНЫЙ резолв из реплики tg_users (снапшот юзеров, которых
  // видел любой аккаунт воркспейса): id по нику — глобальный факт, TDLib для
  // него не нужен. searchPublicChat (лимитированный!) остаётся только для
  // настоящих незнакомцев, которых ни один аккаунт ещё не встречал.
  const [known] = await db
    .select({ userId: tgUsers.userId })
    .from(tgUsers)
    .where(
      and(
        sql`lower(${tgUsers.username}) = ${username.toLowerCase()}`,
        // Конвенция схемы: lookup'ы отсеивают удалённых. Иначе освобождённый
        // ник мог бы навсегда прописать контакту id МЁРТВОГО юзера.
        eq(tgUsers.isDeleted, false),
      ),
    )
    .limit(1);
  if (known) {
    await db
      .update(contacts)
      .set({
        properties: sql`${contacts.properties} || ${JSON.stringify({ tg_user_id: known.userId })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, args.contactId));
    // applyChatUnread здесь НЕ зовём (в отличие от TDLib-ветки): клиент с этим
    // юзером не знаком (иначе tgChats дал бы резолв раньше), getChat упал бы
    // «Chat not found» — только лог-шум без восстановления. Unread догонится
    // обычным путём (listener) после первого знакомства аккаунта с пиром.
    return known.userId;
  }

  // Кулдаун активен → не дёргаем TG (повторные запросы продлевают пенальти).
  const flooded = getSearchFloodUntil(args.accountId);
  if (flooded) throwSearchFlooded(flooded);

  let chat: { type: { _: string; user_id?: number } };
  try {
    chat = (await args.client.invoke({
      _: "searchPublicChat",
      username,
    } as never)) as { type: { _: string; user_id?: number } };
  } catch (e) {
    const msg = errMsg(e);
    console.error(`[ensure-tg-user-id] searchPublicChat ${username}:`, msg);
    const waitSec = parseFloodWaitSeconds(msg);
    if (waitSec) {
      const until = markSearchFlooded(args.accountId, waitSec);
      // Честная ошибка вместо null: null каллеры показывают как «@username
      // не найден в Telegram» — враньё, ник существует, флудит аккаунт.
      throwSearchFlooded(until);
    }
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

  // Контакт ТОЛЬКО ЧТО стал находимым по tg_user_id. Если updateChatReadInbox
  // пришёл, пока контакт был username-only стабом, read-обработчики могли его НЕ
  // зарезолвить: resolveContactByChat промахивается, когда tg_users-реплика ещё
  // холодная И offline getUser не отдал username (частая гонка на первом ответе
  // лида). Тогда authoritative unread отбрасывается как no-contact и переиграть
  // его больше нечем — в мессенджере бейдж есть, у нас 0, карточка выпадает из
  // «Ждут ответа». searchPublicChat выше резолвит надёжнее getUser, так что этот
  // переход — последний шанс восстановить unread. Дочитываем из getChat один раз
  // (applyChatUnread идемпотентен: unread<=0 и совпадение — no-op). Не «лишний
  // RPC на каждом резолве»: ветка достижима только когда tg_user_id ещё не было
  // (ранний return выше), т.е. один раз на контакт.
  void applyChatUnread(
    args.client,
    args.workspaceId,
    args.contactId,
    Number(tgUserId),
  );

  return tgUserId;
}

// Резолв через ПУЛ аккаунтов. tg_user_id — глобальный факт («какой id у @x»),
// он не привязан к аккаунту, а searchPublicChat жёстко лимитирован TG —
// поисковый бюджет воркспейса = сумма живых аккаунтов, а не один выбранный
// (один аккаунт под всеми лукапами копит FLOOD_WAIT на часы). preferred
// (аккаунт дровера) идёт первым; остальные подключаются ЛЕНИВО — только если
// он во флуде (getOutreachWorkerClient может спавнить TDLib, зря не дёргаем).
// Все во флуде → честный 429 с ближайшим временем разблокировки.
export async function ensureContactTgUserIdViaPool(args: {
  workspaceId: string;
  contactId: string;
  properties: Record<string, unknown>;
  preferred: { client: TdClient; accountId: string };
}): Promise<string | null> {
  if (typeof args.properties.tg_user_id === "string") {
    return args.properties.tg_user_id;
  }
  let soonest: number | null = null;
  // ВАЖНО: флуд-кулдаун здесь заранее НЕ проверяем — внутри ensure он стоит
  // ПОСЛЕ бесплатного DB-резолва из реплики (флуднутый аккаунт всё ещё может
  // ответить SELECT'ом; ранний чек тут перепрыгивал реплику и зря отдавал 429).
  const tryOne = async (
    client: TdClient,
    accountId: string,
  ): Promise<string | null | "next"> => {
    try {
      return await ensureContactTgUserId({
        workspaceId: args.workspaceId,
        contactId: args.contactId,
        properties: args.properties,
        client,
        accountId,
      });
    } catch (e) {
      if (e instanceof HTTPException && e.status === 429) {
        const u = searchFloodUntil.get(accountId) ?? Date.now();
        soonest = soonest === null ? u : Math.min(soonest, u);
        return "next";
      }
      throw e;
    }
  };

  const first = await tryOne(args.preferred.client, args.preferred.accountId);
  if (first !== "next") return first;

  const rows = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.workspaceId, args.workspaceId),
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.status, "active"),
      ),
    );
  for (const r of rows) {
    if (r.id === args.preferred.accountId) continue;
    // Заведомо-флуднутый кандидат: клиента НЕ спавним (getOutreachWorkerClient
    // может поднимать TDLib секундами; DB-ветку уже отработал preferred —
    // резолва из реплики нет, кандидат нужен только ради searchPublicChat,
    // который у него всё равно в кулдауне).
    const flooded = getSearchFloodUntil(r.id);
    if (flooded) {
      soonest = soonest === null ? flooded : Math.min(soonest, flooded);
      continue;
    }
    const client = await getOutreachWorkerClient({
      id: r.id,
      workspaceId: args.workspaceId,
    });
    if (!client) continue;
    const res = await tryOne(client, r.id);
    if (res !== "next") return res;
  }
  if (soonest !== null) throwSearchFlooded(soonest);
  return null;
}

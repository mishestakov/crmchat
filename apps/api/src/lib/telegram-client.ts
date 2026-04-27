import { Api, TelegramClient } from "telegram";
import { Raw } from "telegram/events";
import { StringSession } from "telegram/sessions";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { telegramAccounts } from "../db/schema";
import { encrypt, tryDecrypt } from "./crypto";
import { dropQrTokenCache, qrKey, type QrCacheKey } from "./qr-token-cache";
import { silentLogger } from "./silent-logger";

// Один TelegramClient на user — gramjs клиент thread-unsafe для одной session,
// плюс открытое соединение даёт серверу запоминать seen-updates. Кэшируем in-memory
// в Map и переподнимаем lazy.
//
// Для prod (multi-instance) этот Map не подойдёт: каждый Bun-процесс будет иметь
// свой кэш, sticky-routing по user_id или внешний lock. Сейчас single-instance dev.
const clients = new Map<string, TelegramClient>();

// Pending-auth кэш: между HTTP-запросами sendCode → signIn клиент должен жить
// — он держит MTProto-state (phoneCodeHash сервер TG проверяет относительно
// той же session). После успеха перетекает в `clients`/`workerClients` через
// persistSession/persistOutreachAccount; при ошибках/sign-out — clear().
//
// Inflight-промис мемоизируем отдельно, иначе два конкурентных getOrCreate
// (двойной клик «получить QR» / двойной poll) оба создают TelegramClient,
// оба addEventHandler, второй set перетирает первого → первый утекает с
// активным сокетом и слушателем UpdateLoginToken на чужой workspace.
//
// TTL: если auth начали и не закончили (юзер закрыл вкладку), без таймера
// сокет + слушатель висят до перезапуска процесса. 5 минут — потолок жизни
// pendingClient'а с момента последнего обращения.
type PendingEntry = {
  client: TelegramClient;
  qrHandler: (update: Api.TypeUpdate) => void;
  qrEvent: Raw;
  cacheKey: string;
};
const PENDING_TTL_MS = 5 * 60_000;

export type PendingClientStore = {
  getOrCreate: () => Promise<TelegramClient>;
  clear: () => Promise<void>;
};

// shouldDisconnect — для outreach: если клиент уже промоутили в workerClients,
// disconnect ломает inbound-listener. Возвращаем false → закрываем сокет.
export function createPendingClientStore(opts: {
  cacheKey: string;
  shouldDisconnect?: (client: TelegramClient) => boolean;
}): PendingClientStore {
  let entry: PendingEntry | null = null;
  let inflight: Promise<TelegramClient> | null = null;
  let ttlTimer: ReturnType<typeof setTimeout> | null = null;

  function resetTtl(): void {
    if (ttlTimer) clearTimeout(ttlTimer);
    const t = setTimeout(() => {
      void clear();
    }, PENDING_TTL_MS);
    t.unref?.();
    ttlTimer = t;
  }

  async function getOrCreate(): Promise<TelegramClient> {
    if (entry) {
      resetTtl();
      return entry.client;
    }
    if (inflight) return inflight;
    inflight = (async () => {
      const client = newAnonymousClient();
      await client.connect();
      const qrEvent = new Raw({ types: [Api.UpdateLoginToken] });
      const qrHandler = (update: Api.TypeUpdate) => {
        if (update instanceof Api.UpdateLoginToken) {
          dropQrTokenCache(opts.cacheKey as QrCacheKey);
        }
      };
      client.addEventHandler(qrHandler, qrEvent);
      entry = { client, qrHandler, qrEvent, cacheKey: opts.cacheKey };
      resetTtl();
      return client;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function clear(): Promise<void> {
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = null;
    }
    dropQrTokenCache(opts.cacheKey as QrCacheKey);
    const e = entry;
    if (!e) return;
    entry = null;
    e.client.removeEventHandler(e.qrHandler, e.qrEvent);
    if (opts.shouldDisconnect && !opts.shouldDisconnect(e.client)) return;
    try {
      await e.client.disconnect();
    } catch {
      // ignore
    }
  }

  return { getOrCreate, clear };
}

// Per-userId хранилище pending-store'ов. Один user → один pending-флоу.
const userPendingStores = new Map<string, PendingClientStore>();

function pendingStoreFor(userId: string): PendingClientStore {
  let s = userPendingStores.get(userId);
  if (!s) {
    s = createPendingClientStore({ cacheKey: qrKey.telegram(userId) });
    userPendingStores.set(userId, s);
  }
  return s;
}

export function getOrCreatePendingClient(
  userId: string,
): Promise<TelegramClient> {
  return pendingStoreFor(userId).getOrCreate();
}

export async function clearPendingClient(userId: string): Promise<void> {
  await pendingStoreFor(userId).clear();
}

// Единственное место, где читаем TG-creds из env. Все остальные модули
// импортируют tgApiId/tgApiHash отсюда, чтобы предупреждение про unset env
// срабатывало один раз и не было четырёх параллельных copy-paste.
export const tgApiId = Number(process.env.TELEGRAM_API_ID ?? 0);
export const tgApiHash = process.env.TELEGRAM_API_HASH ?? "";
const apiId = tgApiId;
const apiHash = tgApiHash;

if (!apiId || !apiHash) {
  console.warn(
    "[telegram] TELEGRAM_API_ID / TELEGRAM_API_HASH не заданы — TG-фичи не работают",
  );
}

export type AuthorizedClient = TelegramClient & { __authorized: true };

// gramjs не экспортит DC-switch как public API, но у него есть internal `_switchDC`.
// Нужен для QR-flow: когда сервер возвращает LoginTokenMigrateTo, надо
// переключить наш клиент на DC того аккаунта прежде чем ImportLoginToken.
export async function switchDc(
  client: TelegramClient,
  dcId: number,
): Promise<void> {
  await (
    client as unknown as { _switchDC: (dc: number) => Promise<void> }
  )._switchDC(dcId);
}

// Создаёт клиента с пустой session — для первичной аутентификации (QR/phone).
// session-string получим через `client.session.save()` после успешного auth.
export function newAnonymousClient(): TelegramClient {
  return new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 3,
    // Молчаливый logger — gramjs по дефолту шумит INFO в stdout.
    baseLogger: silentLogger(),
  });
}

// Зовёт Api.auth.LogOut() для encrypted-session, чтобы удалить «активное
// устройство» из TG. Без этого session остаётся жить на TG-стороне даже после
// того, как мы удалили её из БД и закрыли локальный сокет. Ошибки глотаем:
// если TG уже выкинул session (force-logout / истекла) — это не должно
// блокировать удаление.
export async function logoutTgSession(encryptedSession: string): Promise<void> {
  const decoded = tryDecrypt(encryptedSession);
  if (!decoded) return;
  const client = new TelegramClient(
    new StringSession(decoded),
    apiId,
    apiHash,
    { connectionRetries: 1, baseLogger: silentLogger() },
  );
  try {
    await client.connect();
    await client.invoke(new Api.auth.LogOut());
  } catch {
    // ignore
  } finally {
    try {
      await client.disconnect();
    } catch {
      // ignore
    }
  }
}

// Достаёт authorized-клиента для user'а (восстанавливает по session из БД).
// Возвращает null если у юзера нет сохранённого telegram_accounts ИЛИ session
// не расшифровывается (legacy plain row после введения encryption — дропаем
// и юзер пере-залогинится).
export async function getUserClient(
  userId: string,
): Promise<TelegramClient | null> {
  const cached = clients.get(userId);
  if (cached && cached.connected) return cached;

  const [acc] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);
  if (!acc) return null;

  const session = tryDecrypt(acc.session);
  if (!session) {
    // Legacy plain или corrupted ciphertext — дропаем, status вернёт unauthorized.
    await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
    return null;
  }

  const client = new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    { connectionRetries: 3, baseLogger: silentLogger() },
  );
  await client.connect();
  clients.set(userId, client);
  return client;
}

// После успешной auth — сохраняем сессию + базовые поля профиля.
export async function persistSession(
  userId: string,
  client: TelegramClient,
  profile: {
    tgUserId: string;
    tgUsername?: string | null;
    phoneNumber?: string | null;
    firstName?: string | null;
  },
) {
  const sessionEnc = encrypt((client.session as StringSession).save() ?? "");
  await db
    .insert(telegramAccounts)
    .values({
      userId,
      session: sessionEnc,
      tgUserId: profile.tgUserId,
      tgUsername: profile.tgUsername ?? null,
      phoneNumber: profile.phoneNumber ?? null,
      firstName: profile.firstName ?? null,
    })
    .onConflictDoUpdate({
      target: telegramAccounts.userId,
      set: {
        session: sessionEnc,
        tgUserId: profile.tgUserId,
        tgUsername: profile.tgUsername ?? null,
        phoneNumber: profile.phoneNumber ?? null,
        firstName: profile.firstName ?? null,
        updatedAt: new Date(),
      },
    });
  clients.set(userId, client);
}

export async function dropUserClient(userId: string): Promise<void> {
  // Сначала вытаскиваем session ДО удаления row — чтобы вызвать TG-side logout
  // (иначе «активное устройство» останется висеть в TG).
  const [acc] = await db
    .select({ session: telegramAccounts.session })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);

  const client = clients.get(userId);
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // ignore — disconnect may throw if connection already broken
    }
    clients.delete(userId);
  }

  if (acc) await logoutTgSession(acc.session);
  await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
}


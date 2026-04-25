import { Api, TelegramClient } from "telegram";
import { Raw } from "telegram/events";
import { StringSession } from "telegram/sessions";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { telegramAccounts } from "../db/schema";
import { encrypt, tryDecrypt } from "./crypto";
import { dropQrTokenCache, qrKey } from "./qr-token-cache";
import { silentLogger } from "./silent-logger";

// Один TelegramClient на user — gramjs клиент thread-unsafe для одной session,
// плюс открытое соединение даёт серверу запоминать seen-updates. Кэшируем in-memory
// в Map и переподнимаем lazy.
//
// Для prod (multi-instance) этот Map не подойдёт: каждый Bun-процесс будет иметь
// свой кэш, sticky-routing по user_id или внешний lock. Сейчас single-instance dev.
const clients = new Map<string, TelegramClient>();

// Отдельный кэш для pending-auth клиентов: юзер ещё не аутентифицирован в TG, но
// уже есть наша сессия (userId). Между HTTP-запросами sendCode → signIn клиент
// должен жить — он держит MTProto-state (phoneCodeHash проверяется на сервере TG
// относительно той же session). После успеха перетекает в `clients` через
// persistSession; при ошибках/sign-out — clearPending.
type PendingEntry = {
  client: TelegramClient;
  qrHandler: (update: Api.TypeUpdate) => void;
  qrEvent: Raw;
};
const pendingClients = new Map<string, PendingEntry>();

export async function getOrCreatePendingClient(
  userId: string,
): Promise<TelegramClient> {
  // Не лезем в .connected — getter возвращает undefined для свежего клиента,
  // и мы бы пересоздавали его на каждый poll → новая session → QR из poll N
  // невидим для poll N+1.
  const existing = pendingClients.get(userId);
  if (existing) return existing.client;
  const client = newAnonymousClient();
  await client.connect();
  const qrEvent = new Raw({ types: [Api.UpdateLoginToken] });
  const qrHandler = (update: Api.TypeUpdate) => {
    if (update instanceof Api.UpdateLoginToken) {
      dropQrTokenCache(qrKey.telegram(userId));
    }
  };
  client.addEventHandler(qrHandler, qrEvent);
  pendingClients.set(userId, { client, qrHandler, qrEvent });
  return client;
}

export async function clearPendingClient(userId: string): Promise<void> {
  dropQrTokenCache(qrKey.telegram(userId));
  const entry = pendingClients.get(userId);
  if (entry) {
    entry.client.removeEventHandler(entry.qrHandler, entry.qrEvent);
    try {
      await entry.client.disconnect();
    } catch {
      // ignore
    }
    pendingClients.delete(userId);
  }
}

const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

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
  const client = clients.get(userId);
  if (client) {
    try {
      await client.disconnect();
    } catch {
      // ignore — disconnect may throw if connection already broken
    }
    clients.delete(userId);
  }
  await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
}


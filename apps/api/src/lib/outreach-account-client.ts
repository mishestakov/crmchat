import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { outreachAccounts } from "../db/schema";
import { encrypt, tryDecrypt } from "./crypto";
import { attachListener, detachListener } from "./outreach-listener";
import { qrKey } from "./qr-token-cache";
import { silentLogger } from "./silent-logger";
import {
  createPendingClientStore,
  logoutTgSession,
  type PendingClientStore,
  tgApiHash as apiHash,
  tgApiId as apiId,
} from "./telegram-client";

// Кэш authorized-клиентов для worker'а: один long-lived TelegramClient на
// outreach-аккаунт. Клиент держит MTProto-state (peer cache, last-seen-updates)
// — переподнимать на каждый tick = терять кэш + лишний handshake.
//   - lazy: создаётся при первом отправлении из этого аккаунта
//   - eviction: вызывает worker когда поймал AUTH_KEY_UNREGISTERED / banned
const workerClients = new Map<string, TelegramClient>();
// Set, чтобы pending-store O(1) проверил, не промоутили ли клиента в worker
// (раньше делали O(n) [...workerClients.values()].includes(client)).
const promotedClients = new Set<TelegramClient>();

const pendingStores = new Map<string, PendingClientStore>();

function pendingStoreFor(workspaceId: string): PendingClientStore {
  let s = pendingStores.get(workspaceId);
  if (!s) {
    s = createPendingClientStore({
      cacheKey: qrKey.outreach(workspaceId),
      // Если клиент уже промоутили в workerClients — НЕ отключаем: он держит
      // inbound NewMessage-listener для воркера. Возвращаем false →
      // pending-store снимает qrHandler, но disconnect не зовёт.
      shouldDisconnect: (client) => !promotedClients.has(client),
    });
    pendingStores.set(workspaceId, s);
  }
  return s;
}

export function getOrCreatePendingOutreachClient(
  workspaceId: string,
): Promise<TelegramClient> {
  return pendingStoreFor(workspaceId).getOrCreate();
}

export async function clearPendingOutreachClient(
  workspaceId: string,
): Promise<void> {
  await pendingStoreFor(workspaceId).clear();
}

export async function persistOutreachAccount(
  workspaceId: string,
  userId: string,
  client: TelegramClient,
  profile: {
    tgUserId: string;
    tgUsername?: string | null;
    phoneNumber?: string | null;
    firstName?: string | null;
    hasPremium: boolean;
  },
): Promise<{ id: string }> {
  const sessionEnc = encrypt((client.session as StringSession).save() ?? "");

  const [row] = await db
    .insert(outreachAccounts)
    .values({
      workspaceId,
      session: sessionEnc,
      tgUserId: profile.tgUserId,
      tgUsername: profile.tgUsername ?? null,
      phoneNumber: profile.phoneNumber ?? null,
      firstName: profile.firstName ?? null,
      hasPremium: profile.hasPremium,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [outreachAccounts.workspaceId, outreachAccounts.tgUserId],
      set: {
        session: sessionEnc,
        tgUsername: profile.tgUsername ?? null,
        phoneNumber: profile.phoneNumber ?? null,
        firstName: profile.firstName ?? null,
        hasPremium: profile.hasPremium,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning({ id: outreachAccounts.id });
  // Промоутим auth-клиента в worker'ный кэш + сразу attach inbound listener.
  // Иначе listener подключится только при первой исходящей — лид может
  // ответить раньше и мы потеряем event.
  workerClients.set(row!.id, client);
  promotedClients.add(client);
  attachListener(row!.id, workspaceId, client);
  return row!;
}

export async function deleteOutreachAccount(
  workspaceId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (row) {
    // worker и iframe делят одну session — один logout снимает «активное
    // устройство» в TG.
    await logoutTgSession(row.session);
  }

  await evictWorkerClient(accountId);
  const result = await db
    .delete(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, workspaceId),
      ),
    )
    .returning({ id: outreachAccounts.id });
  return result.length > 0;
}

// Поднимает (или возвращает кэш) authorized-клиента под worker. Помимо отправки
// клиент держит inbound NewMessage-listener (см. outreach-listener.ts), поэтому
// один client = и отправитель, и слушатель ответов в этом же диалоге.
//
// Возвращает null если session не расшифровалась — worker должен пометить
// аккаунт unauthorized и не пытаться его использовать.
export async function getOutreachWorkerClient(account: {
  id: string;
  workspaceId: string;
  session: string;
}): Promise<TelegramClient | null> {
  const cached = workerClients.get(account.id);
  if (cached && cached.connected) return cached;

  const session = tryDecrypt(account.session);
  if (!session) return null;

  const client = new TelegramClient(
    new StringSession(session),
    apiId,
    apiHash,
    { connectionRetries: 3, baseLogger: silentLogger() },
  );
  await client.connect();
  workerClients.set(account.id, client);
  promotedClients.add(client);
  attachListener(account.id, account.workspaceId, client);
  return client;
}

export async function evictWorkerClient(accountId: string): Promise<void> {
  const client = workerClients.get(accountId);
  if (!client) return;
  workerClients.delete(accountId);
  promotedClients.delete(client);
  detachListener(accountId, client);
  try {
    await client.disconnect();
  } catch {
    // ignore — connection might already be broken
  }
}


import { Api, TelegramClient } from "telegram";
import { Raw } from "telegram/events";
import { StringSession } from "telegram/sessions";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { outreachAccounts } from "../db/schema";
import { encrypt, tryDecrypt } from "./crypto";
import { attachListener, detachListener } from "./outreach-listener";
import { dropQrTokenCache, qrKey } from "./qr-token-cache";
import { silentLogger } from "./silent-logger";
import { newAnonymousClient, switchDc } from "./telegram-client";

const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
const apiHash = process.env.TELEGRAM_API_HASH ?? "";

// Кэш authorized-клиентов для worker'а: один long-lived TelegramClient на
// outreach-аккаунт. Клиент держит MTProto-state (peer cache, last-seen-updates)
// — переподнимать на каждый tick = терять кэш + лишний handshake.
//   - lazy: создаётся при первом отправлении из этого аккаунта
//   - eviction: вызывает worker когда поймал AUTH_KEY_UNREGISTERED / banned
const workerClients = new Map<string, TelegramClient>();

// Pending-clients per workspace: только ОДИН auth-флоу за раз внутри workspace.
// Если юзер начнёт второй до окончания первого — старый сбрасываем (новый
// sendCode/getQrState создаст fresh client). Multi-instance prod: см. TODO про
// sticky-routing в telegram-client.ts.
type PendingEntry = {
  client: TelegramClient;
  qrHandler: (update: Api.TypeUpdate) => void;
  qrEvent: Raw;
};
const pending = new Map<string, PendingEntry>();

export async function getOrCreatePendingOutreachClient(
  workspaceId: string,
): Promise<TelegramClient> {
  const existing = pending.get(workspaceId);
  if (existing) return existing.client;
  const client = newAnonymousClient();
  await client.connect();
  const qrEvent = new Raw({ types: [Api.UpdateLoginToken] });
  const qrHandler = (update: Api.TypeUpdate) => {
    if (update instanceof Api.UpdateLoginToken) {
      dropQrTokenCache(qrKey.outreach(workspaceId));
    }
  };
  client.addEventHandler(qrHandler, qrEvent);
  pending.set(workspaceId, { client, qrHandler, qrEvent });
  return client;
}

export async function clearPendingOutreachClient(
  workspaceId: string,
): Promise<void> {
  const entry = pending.get(workspaceId);
  if (!entry) return;
  pending.delete(workspaceId);
  dropQrTokenCache(qrKey.outreach(workspaceId));
  // QR-handler привязан к pending-flow и больше не нужен (cache-key всё равно
  // сейчас инвалидируется этим вызовом). Снимаем независимо от того, ушёл
  // клиент в worker или умирает.
  entry.client.removeEventHandler(entry.qrHandler, entry.qrEvent);
  // Если этого же клиента уже промоутили в workerClients — НЕ отключаем:
  // он держит inbound NewMessage-listener для воркера.
  const promoted = [...workerClients.values()].includes(entry.client);
  if (promoted) return;
  try {
    await entry.client.disconnect();
  } catch {
    // ignore
  }
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
  const iframeSessionStr = await provisionIframeSessionStr(client);
  const iframeSessionEnc = encrypt(iframeSessionStr);

  const [row] = await db
    .insert(outreachAccounts)
    .values({
      workspaceId,
      session: sessionEnc,
      iframeSession: iframeSessionEnc,
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
        iframeSession: iframeSessionEnc,
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
  attachListener(row!.id, workspaceId, client);
  return row!;
}

// Создаёт второй TG-сессию через login-token flow (как у QR-логина нового
// устройства). Worker одобряет invitation-token от анонимного клиента —
// тот авторизуется под тем же user'ом со своим auth_key. См. td_api.tl:
// requestQrCodeAuth + confirmQrCodeAuth (тот же flow на MTProto-уровне).
async function provisionIframeSessionStr(
  workerClient: TelegramClient,
): Promise<string> {
  const iframeClient = newAnonymousClient();
  await iframeClient.connect();
  try {
    const initial = (await iframeClient.invoke(
      new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
    )) as Api.auth.LoginToken;

    await workerClient.invoke(
      new Api.auth.AcceptLoginToken({ token: initial.token }),
    );

    const finalized = (await iframeClient.invoke(
      new Api.auth.ExportLoginToken({ apiId, apiHash, exceptIds: [] }),
    )) as Api.auth.LoginToken | Api.auth.LoginTokenSuccess | Api.auth.LoginTokenMigrateTo;

    if (finalized instanceof Api.auth.LoginTokenMigrateTo) {
      await switchDc(iframeClient, finalized.dcId);
      await iframeClient.invoke(
        new Api.auth.ImportLoginToken({ token: finalized.token }),
      );
    }

    return (iframeClient.session as StringSession).save() ?? "";
  } finally {
    try {
      await iframeClient.disconnect();
    } catch {
      // ignore
    }
  }
}

// Разлогинивает одну encrypted-session на TG-стороне. Ошибки глотаем: если TG
// уже выкинул session (устарела / force-logout) — это не должно блокировать
// удаление из БД.
async function logoutSession(encryptedSession: string): Promise<void> {
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
    // Logout на TG-стороне обеих сессий параллельно, иначе они остаются в
    // юзерских «активных устройствах» после удаления из CRM.
    await Promise.allSettled([
      logoutSession(row.session),
      logoutSession(row.iframeSession),
    ]);
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
  attachListener(account.id, account.workspaceId, client);
  return client;
}

export async function evictWorkerClient(accountId: string): Promise<void> {
  const client = workerClients.get(accountId);
  if (!client) return;
  workerClients.delete(accountId);
  detachListener(accountId, client);
  try {
    await client.disconnect();
  } catch {
    // ignore — connection might already be broken
  }
}


import { and, eq, ne } from "drizzle-orm";
import { db } from "../db/client";
import { outreachAccounts } from "../db/schema";
import { shortId } from "../db/short-id";
import { encrypt } from "./crypto";
import { errMsg } from "./errors";
import { attachListener, detachListener } from "./outreach-listener";
import {
  attachAuthStateBus,
  createPendingTdStore,
  createTdClient,
  destroyTdAccount,
  extractActiveUsername,
  provisionIframeSession,
  renameTdAccount,
  waitForAuthState,
  type AuthStateBus,
  type PendingEntry,
  type PendingStore,
  type TdClient,
  type TdUser,
} from "./tdlib";

// Outreach-аккаунт = один TDLib-инстанс c databaseDirectory'ом
// `outreach/<accountId>/`. Persistent FS-state: auth-key, peer cache,
// pts/qts/seq для надёжной доставки updates.
//
// Кэш per-accountId: TDLib работает «всегда вживую» (один long-lived TCP к
// серверам TG, push updates), так что переподнимать клиента на каждый tick
// = терять кэш + тратить лишний handshake.

type WorkerEntry = {
  client: TdClient;
  authBus: AuthStateBus;
};

const workerClients = new Map<string, WorkerEntry>();
// Single-flight: одновременный warmup + tick могут оба вызвать
// getOutreachWorkerClient до того как первый запишет в workerClients —
// получим два TdClient на один binlog и фатальный file-lock.
const workerInflight = new Map<string, Promise<TdClient | null>>();
const pendingStores = new Map<string, PendingStore>();
// Per-account FloodWait cooldown. Заполняется в worker'е при FloodWaitError,
// читается тем же worker'ом, чистится при evict (чтобы не пережить аккаунт).
export const accountCooldownUntil = new Map<string, number>();

function pendingStoreFor(workspaceId: string): PendingStore {
  let s = pendingStores.get(workspaceId);
  if (!s) {
    s = createPendingTdStore({
      // Резервируем accountId до того как row попадёт в БД. При успехе persist
      // INSERT'ит этот же id; при abandon — destroyTdAccount подчищает dir.
      // Если на persist'е выясняется, что (workspaceId, tgUserId) уже занят
      // — accountId меняется на existing, dir переезжает rename'ом (см.
      // persistOutreachAccount).
      resolveKey: () => ({ kind: "outreach", accountId: shortId() }),
      deviceModel: "CRM Outreach",
    });
    pendingStores.set(workspaceId, s);
  }
  return s;
}

export async function getOrCreatePendingOutreachClient(
  workspaceId: string,
): Promise<PendingEntry> {
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
  pending: PendingEntry,
): Promise<{ id: string }> {
  // 1) Извлекаем профиль пока pending-клиент ещё открыт.
  const me = (await pending.client.invoke({ _: "getMe" } as never)) as TdUser;
  const tgUserId = String(me.id);
  // По TL все поля required; пустая строка для deleted-юзера — нормальный
  // case, мапим в null чтобы хранить аккуратные null'ы в БД.
  const profile = {
    tgUserId,
    tgUsername: extractActiveUsername(me),
    phoneNumber: me.phone_number ? `+${me.phone_number}` : null,
    firstName: me.first_name || null,
    hasPremium: me.is_premium,
  };

  // 2) Решаем: новый аккаунт или re-auth существующего.
  const [existing] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.workspaceId, workspaceId),
        eq(outreachAccounts.tgUserId, tgUserId),
      ),
    )
    .limit(1);

  const pendingKey = pending.key;
  if (pendingKey.kind !== "outreach") {
    throw new Error("pending store has non-outreach key");
  }
  const pendingAccountId = pendingKey.accountId;
  const finalAccountId = existing?.id ?? pendingAccountId;

  // 3) Закрываем pending-клиента (он держит fd на td-database/<pendingId>/).
  // Без close на Linux rename работает (fd следуют за inode), но мы
  // потом всё равно создаём новый клиент — экономии нет.
  pending.authBus.detach();
  try {
    await pending.client.close();
  } catch (e) {
    console.error("[persistOutreachAccount] close pending failed:", e);
  }
  // Снимаем «контроль» pending-store над клиентом — TTL не сработает после persist.
  pendingStoreFor(workspaceId).promote();

  // 4) Если был existing — выселяем старого worker'а и сносим его td-database.
  if (existing) {
    await evictWorkerClient(existing.id);
    await destroyTdAccount({ kind: "outreach", accountId: existing.id }).catch(
      (e) => console.error("[persistOutreachAccount] destroy old dir:", e),
    );
  }

  // 5) Переезжаем td-database/<pendingId>/ → td-database/<finalId>/
  if (pendingAccountId !== finalAccountId) {
    await renameTdAccount(
      { kind: "outreach", accountId: pendingAccountId },
      { kind: "outreach", accountId: finalAccountId },
    );
  }

  // 6) UPSERT row.
  const [row] = await db
    .insert(outreachAccounts)
    .values({
      id: finalAccountId,
      workspaceId,
      tgUserId: profile.tgUserId,
      tgUsername: profile.tgUsername,
      phoneNumber: profile.phoneNumber,
      firstName: profile.firstName,
      hasPremium: profile.hasPremium,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [outreachAccounts.workspaceId, outreachAccounts.tgUserId],
      set: {
        tgUsername: profile.tgUsername,
        phoneNumber: profile.phoneNumber,
        firstName: profile.firstName,
        hasPremium: profile.hasPremium,
        status: "active",
        updatedAt: new Date(),
      },
    })
    .returning({ id: outreachAccounts.id });

  // 7) Поднимаем рабочего клиента на финальном dir.
  const worker = await spawnWorker(finalAccountId, workspaceId);
  workerClients.set(finalAccountId, worker);

  // 8) ВТОРОЙ независимый auth_key для iframe (TWA). Worker confirms QR
  // временного TDLib instance'а; при 2FA — переюзаем уже-введённый пароль
  // из pending.lastPassword (RAM-only, не из БД).
  //
  // ВАЖНО: pauseWorker callback закрывает worker между confirmQrCodeAuthentication
  // и checkAuthenticationPassword на iframe. Иначе catchup-spam worker'а
  // блокирует iframe finalize на минуты. После провижна re-spawn worker'а.
  let workerPaused = false;
  try {
    const twa = await provisionIframeSession(
      worker.client,
      finalAccountId,
      pending.lastPassword,
      async () => {
        if (workerPaused) return;
        workerPaused = true;
        detachListener(finalAccountId, worker.client);
        worker.authBus.detach();
        try {
          await worker.client.close();
        } catch {
          // ignore
        }
        workerClients.delete(finalAccountId);
      },
    );
    await db
      .update(outreachAccounts)
      .set({ iframeSession: encrypt(JSON.stringify(twa)) })
      .where(eq(outreachAccounts.id, finalAccountId));
  } catch (e) {
    console.error(
      "[persistOutreachAccount] provisionIframeSession failed:",
      e instanceof Error ? (e.stack ?? e.message) : String(e),
    );
  } finally {
    pending.lastPassword = undefined;
    if (workerPaused) {
      try {
        const reborn = await spawnWorker(finalAccountId, workspaceId);
        workerClients.set(finalAccountId, reborn);
      } catch (e) {
        console.error(
          "[persistOutreachAccount] respawn worker failed:",
          errMsg(e),
        );
      }
    }
  }

  return { id: row!.id };
}

async function spawnWorker(
  accountId: string,
  workspaceId?: string,
): Promise<WorkerEntry> {
  const client = createTdClient({
    key: { kind: "outreach", accountId },
    deviceModel: "CRM Outreach",
  });
  const authBus = attachAuthStateBus(client);
  client.on("error", (e) =>
    console.error(`[outreach-worker] tdlib error ${accountId}:`, e),
  );
  // td-database уже содержит auth-key, ждём пока state раскрутится до ready.
  await waitForAuthState(authBus, (s) => s.kind === "ready", 30_000);
  // Только LoggingOut = TG явно отозвал session (см. td_api.tl:200). Closing/
  // Closed — наш собственный teardown (HMR-restart, evictWorkerClient,
  // process exit) и НЕ должен пометить аккаунт unauthorized; иначе после
  // рестарта api все active outreach-аккаунты ушли бы в unauthorized.
  authBus.subscribe((s) => {
    if (s.kind === "logging_out") {
      void markUnauthorized(accountId);
    }
  });
  if (workspaceId) attachListener(accountId, workspaceId, client);
  return { client, authBus };
}

async function markUnauthorized(accountId: string): Promise<void> {
  // ne(status, 'unauthorized') защищает от шторма updates — TDLib эмитит
  // logging_out → closed подряд, оба триггерят этот хелпер.
  await db
    .update(outreachAccounts)
    .set({ status: "unauthorized", updatedAt: new Date() })
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        ne(outreachAccounts.status, "unauthorized"),
      ),
    )
    .catch((e) => console.error("[markUnauthorized] failed:", errMsg(e)));
  await evictWorkerClient(accountId);
}

export async function deleteOutreachAccount(
  workspaceId: string,
  accountId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: outreachAccounts.id })
    .from(outreachAccounts)
    .where(
      and(
        eq(outreachAccounts.id, accountId),
        eq(outreachAccounts.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) return false;

  // Перед logOut'ом worker'а — убиваем iframe-сессию через getActiveSessions
  // → terminateSession (device_model='CRM iframe'). После logOut worker'а
  // session_id уже невалиден, поэтому порядок строгий.
  // Если worker нет в кэше (api рестартанул и warmup упал) — поднимаем
  // временно, чтобы успеть сделать logOut/terminate перед удалением.
  let worker = workerClients.get(accountId);
  if (!worker) {
    try {
      worker = await spawnWorker(accountId);
      workerClients.set(accountId, worker);
    } catch (e) {
      console.error(
        "[deleteOutreachAccount] spawn worker for cleanup failed:",
        errMsg(e),
      );
    }
  }
  if (worker) {
    try {
      const sessions = (await worker.client.invoke({
        _: "getActiveSessions",
      } as never)) as {
        sessions?: Array<{ id: string | number; device_model?: string; is_current?: boolean }>;
      };
      for (const s of sessions.sessions ?? []) {
        if (s.is_current) continue;
        if (s.device_model === "CRM iframe") {
          await worker.client
            .invoke({
              _: "terminateSession",
              session_id: s.id,
            } as never)
            .catch((e: unknown) =>
              console.error(
                "[deleteOutreachAccount] terminate iframe session:",
                errMsg(e),
              ),
            );
        }
      }
    } catch (e) {
      console.error(
        "[deleteOutreachAccount] getActiveSessions:",
        errMsg(e),
      );
    }
    try {
      await worker.client.invoke({ _: "logOut" } as never);
    } catch {
      // session могла быть уже отозвана — продолжаем
    }
  }
  await evictWorkerClient(accountId);
  await destroyTdAccount({ kind: "outreach", accountId }).catch((e) =>
    console.error("[deleteOutreachAccount] destroy dir:", errMsg(e)),
  );

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
// клиент держит inbound listener (см. outreach-listener.ts).
//
// Возвращает null, если td-database директория сломана / не auth — в этом
// случае worker помечает аккаунт unauthorized и не пытается слать.
export async function getOutreachWorkerClient(account: {
  id: string;
  workspaceId: string;
}): Promise<TdClient | null> {
  const cached = workerClients.get(account.id);
  if (cached) {
    if (cached.authBus.current().kind === "ready") return cached.client;
    try {
      await waitForAuthState(
        cached.authBus,
        (s) => s.kind === "ready" || s.kind === "closed",
        10_000,
      );
      if (cached.authBus.current().kind === "ready") return cached.client;
    } catch {
      // timeout
    }
    await evictWorkerClient(account.id);
  }

  const inflight = workerInflight.get(account.id);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const worker = await spawnWorker(account.id, account.workspaceId);
      workerClients.set(account.id, worker);
      return worker.client;
    } catch (e) {
      console.error(
        `[getOutreachWorkerClient] spawn failed for ${account.id}:`,
        errMsg(e),
      );
      return null;
    } finally {
      workerInflight.delete(account.id);
    }
  })();
  workerInflight.set(account.id, promise);
  return promise;
}

export async function evictWorkerClient(accountId: string): Promise<void> {
  const entry = workerClients.get(accountId);
  if (!entry) return;
  workerClients.delete(accountId);
  accountCooldownUntil.delete(accountId);
  detachListener(accountId, entry.client);
  entry.authBus.detach();
  try {
    await entry.client.close();
  } catch {
    // already closed
  }
}


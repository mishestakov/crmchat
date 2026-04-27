import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { telegramAccounts } from "../db/schema";
import { errMsg } from "./errors";
import {
  attachAuthStateBus,
  createPendingTdStore,
  createTdClient,
  destroyTdAccount,
  extractActiveUsername,
  waitForAuthState,
  type AuthStateBus,
  type PendingEntry,
  type PendingStore,
  type TdClient,
  type TdUser,
} from "./tdlib";

// Personal CRM-аккаунт юзера (один на user, для импорта чатов из TG-папок в
// контакты). TDLib-инстанс c databaseDirectory'ом `personal/<userId>/`.

type PersonalEntry = {
  client: TdClient;
  authBus: AuthStateBus;
};

const personalClients = new Map<string, PersonalEntry>();
// Single-flight: одновременные getPersonalClient до того как первый запишет
// клиента → два TdClient на один binlog → file-lock.
const personalInflight = new Map<string, Promise<TdClient | null>>();
const pendingStores = new Map<string, PendingStore>();

function pendingStoreFor(userId: string): PendingStore {
  let s = pendingStores.get(userId);
  if (!s) {
    s = createPendingTdStore({
      // У личного аккаунта key стабильный — `personal/<userId>/`. Если
      // юзер пере-логинится с другим TG-юзером, мы перезатрём содержимое
      // dir'а (см. persistPersonalAccount). Это окей: один user → один TG.
      resolveKey: () => ({ kind: "personal", userId }),
      deviceModel: "CRM Sync",
    });
    pendingStores.set(userId, s);
  }
  return s;
}

export function getOrCreatePendingPersonalClient(
  userId: string,
): Promise<PendingEntry> {
  return pendingStoreFor(userId).getOrCreate();
}

export async function clearPendingPersonalClient(userId: string): Promise<void> {
  await pendingStoreFor(userId).clear();
}

export async function persistPersonalAccount(
  userId: string,
  pending: PendingEntry,
): Promise<void> {
  if (pending.key.kind !== "personal") {
    throw new Error("pending store has non-personal key");
  }

  const me = (await pending.client.invoke({ _: "getMe" } as never)) as TdUser;
  const profile = {
    tgUserId: String(me.id),
    tgUsername: extractActiveUsername(me),
    phoneNumber: me.phone_number ? `+${me.phone_number}` : null,
    firstName: me.first_name ?? null,
  };

  // Promote pending → personalClients (без close + reconnect): databaseDirectory
  // у pending уже совпадает с финальным (`personal/<userId>/`), новый клиент
  // не нужен.
  pendingStoreFor(userId).promote();

  // Если у юзера висит старый personalClient (re-auth) — гасим его.
  const old = personalClients.get(userId);
  if (old && old.client !== pending.client) {
    try {
      await old.client.close();
    } catch {
      // ignore
    }
    old.authBus.detach();
  }

  personalClients.set(userId, {
    client: pending.client,
    authBus: pending.authBus,
  });

  await db
    .insert(telegramAccounts)
    .values({
      userId,
      tgUserId: profile.tgUserId,
      tgUsername: profile.tgUsername,
      phoneNumber: profile.phoneNumber,
      firstName: profile.firstName,
    })
    .onConflictDoUpdate({
      target: telegramAccounts.userId,
      set: {
        tgUserId: profile.tgUserId,
        tgUsername: profile.tgUsername,
        phoneNumber: profile.phoneNumber,
        firstName: profile.firstName,
        updatedAt: new Date(),
      },
    });
}

export async function getPersonalClient(
  userId: string,
): Promise<TdClient | null> {
  const cached = personalClients.get(userId);
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
      // timeout — пересоздадим
    }
    try {
      await cached.client.close();
    } catch {
      // ignore
    }
    cached.authBus.detach();
    personalClients.delete(userId);
  }

  const inflight = personalInflight.get(userId);
  if (inflight) return inflight;

  // td-database/personal/<userId>/ должен уже содержать auth-state из
  // предыдущей persist'нутой сессии. Поднимаем клиент и ждём ready.
  const promise = (async () => {
    try {
      const [acc] = await db
        .select({ id: telegramAccounts.id })
        .from(telegramAccounts)
        .where(eq(telegramAccounts.userId, userId))
        .limit(1);
      if (!acc) return null;
      const client = createTdClient({
        key: { kind: "personal", userId },
        deviceModel: "CRM Sync",
      });
      const authBus = attachAuthStateBus(client);
      client.on("error", (e) =>
        console.error(`[personal] tdlib error ${userId}:`, e),
      );
      await waitForAuthState(authBus, (s) => s.kind === "ready", 30_000);
      personalClients.set(userId, { client, authBus });
      return client;
    } catch (e) {
      console.error(`[personal] revive failed for ${userId}:`, errMsg(e));
      return null;
    } finally {
      personalInflight.delete(userId);
    }
  })();
  personalInflight.set(userId, promise);
  return promise;
}

export async function dropPersonalClient(userId: string): Promise<void> {
  const entry = personalClients.get(userId);
  if (entry) {
    try {
      await entry.client.invoke({ _: "logOut" } as never);
    } catch {
      // session могла быть уже отозвана
    }
    try {
      await entry.client.close();
    } catch {
      // ignore
    }
    entry.authBus.detach();
    personalClients.delete(userId);
  }
  await destroyTdAccount({ kind: "personal", userId }).catch((e) =>
    console.error("[personal] destroy dir:", errMsg(e)),
  );
  await db
    .delete(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId));
}

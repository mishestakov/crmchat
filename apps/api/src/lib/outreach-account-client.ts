import { and, eq, isNull, lte, ne, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { channelSubscriptions, outreachAccounts } from "../db/schema.ts";
import { shortId } from "../db/short-id.ts";
import { errMsg } from "./errors.ts";
import { attachListener, detachListener } from "./outreach-listener.ts";
import { attachReplicator, type ReplicatorHandle } from "./tg-replicator.ts";
import {
  attachAuthStateBus,
  createPendingTdStore,
  createTdClient,
  destroyTdAccount,
  extractActiveUsername,
  renameTdAccount,
  waitForAuthState,
  type AuthStateBus,
  type PendingEntry,
  type PendingStore,
  type TdClient,
  type TdUser,
} from "./tdlib/index.ts";

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
  replicator: ReplicatorHandle;
};

const workerClients = new Map<string, WorkerEntry>();
// Single-flight: одновременный warmup + tick могут оба вызвать
// getOutreachWorkerClient до того как первый запишет в workerClients —
// получим два TdClient на один binlog и фатальный file-lock.
const workerInflight = new Map<string, Promise<TdClient | null>>();
const pendingStores = new Map<string, PendingStore>();

// FloodWait cooldown живёт в outreach_accounts.cooldown_until/_reason —
// чтобы переживать рестарт API и показываться менеджеру в UI. Helper'ы
// ниже инкапсулируют UPDATE'ы. Чтение — в местах где аккаунт грузится
// SELECT'ом (worker.processAccount, quick-send preview).
export async function setAccountCooldown(
  accountId: string,
  untilMs: number,
  reason: string,
): Promise<void> {
  await db
    .update(outreachAccounts)
    .set({
      cooldownUntil: new Date(untilMs),
      cooldownReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(outreachAccounts.id, accountId));
}

export async function clearAccountCooldown(accountId: string): Promise<void> {
  await db
    .update(outreachAccounts)
    .set({ cooldownUntil: null, cooldownReason: null, updatedAt: new Date() })
    .where(eq(outreachAccounts.id, accountId));
}

// Парсер FLOOD_WAIT/SLOWMODE из текста ошибки TDLib. Общий для всех, кто
// дёргает аккаунт (рассылка И снятие метрик) — rate-budget у аккаунта один,
// FloodWait прилетает на любой метод, поэтому парсер живёт здесь, не в воркере.
export function parseFloodWaitSeconds(msg: string): number | null {
  // TDLib переписывает MTProto FLOOD_WAIT в "Too Many Requests: retry after N",
  // но для некоторых методов оставляет MTProto-style текст.
  const m1 = msg.match(/retry after (\d+)/i);
  if (m1) return Number(m1[1]);
  const m2 = msg.match(/FLOOD_WAIT_(\d+)/);
  if (m2) return Number(m2[1]);
  const m3 = msg.match(/SLOWMODE_WAIT_(\d+)/);
  if (m3) return Number(m3[1]);
  return null;
}

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
        eq(outreachAccounts.platform, "telegram"),
        eq(outreachAccounts.externalUserId, tgUserId),
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
      platform: "telegram",
      externalUserId: profile.tgUserId,
      externalUsername: profile.tgUsername,
      phoneNumber: profile.phoneNumber,
      firstName: profile.firstName,
      hasPremium: profile.hasPremium,
      ownerUserId: userId,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [
        outreachAccounts.workspaceId,
        outreachAccounts.platform,
        outreachAccounts.externalUserId,
      ],
      set: {
        externalUsername: profile.tgUsername,
        phoneNumber: profile.phoneNumber,
        firstName: profile.firstName,
        hasPremium: profile.hasPremium,
        status: "active",
        updatedAt: new Date(),
        // ownerUserId не трогаем при reconnect: если аккаунт был передан
        // другому менеджеру (transfer/делегация), не отбираем обратно
        // молча — UI покажет «аккаунт у Маши», переподключающий разберётся.
      },
    })
    .returning({ id: outreachAccounts.id });

  // 7) Поднимаем рабочего клиента на финальном dir. Одна TDLib-сессия на
  // аккаунт — под ней и шлём, и читаем (worker + listener + replicator).
  const worker = await spawnWorker(finalAccountId, workspaceId);
  workerClients.set(finalAccountId, worker);

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
  // TG-репликация: пишем chat list / user directory в Postgres (см.
  // tg-replicator.ts). Подцепляем здесь — после ready, до возврата клиента.
  const replicator = attachReplicator(accountId, client);
  return { client, authBus, replicator };
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

  // logOut worker'а отзывает session в TG. Если worker нет в кэше (api
  // рестартанул и warmup упал) — поднимаем временно ради logOut.
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
// Активный аккаунт воркспейса, ПОДПИСАННЫЙ на канал (для приватных — единственный,
// кто прочитает). Общий выбор для ленты канала (pickChannelReader) и снятия
// метрик (metrics-worker). respectCooldown — пропускать забенченные по FloodWait
// (для фоновых чтений true; для интерактивной ленты — false).
export async function findSubscribedReaderAccount(
  workspaceId: string,
  channelId: string,
  respectCooldown = false,
): Promise<{ id: string; workspaceId: string } | null> {
  const conds = [
    eq(channelSubscriptions.channelId, channelId),
    eq(channelSubscriptions.status, "subscribed"),
    eq(outreachAccounts.workspaceId, workspaceId),
    eq(outreachAccounts.status, "active"),
  ];
  if (respectCooldown) {
    conds.push(
      or(
        isNull(outreachAccounts.cooldownUntil),
        lte(outreachAccounts.cooldownUntil, new Date()),
      )!,
    );
  }
  const [acc] = await db
    .select({
      id: outreachAccounts.id,
      workspaceId: outreachAccounts.workspaceId,
    })
    .from(channelSubscriptions)
    .innerJoin(
      outreachAccounts,
      eq(outreachAccounts.id, channelSubscriptions.accountId),
    )
    .where(and(...conds))
    .limit(1);
  return acc ?? null;
}

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
      // Граница движка: TDLib только для telegram-аккаунтов. Если селект-вызывающий
      // забыл platform-фильтр и сюда дошёл MAX (или иной) аккаунт — не плодим
      // пустой td-database, падаем громко в одной точке вместо тихого спавна.
      const [row] = await db
        .select({ platform: outreachAccounts.platform })
        .from(outreachAccounts)
        .where(eq(outreachAccounts.id, account.id))
        .limit(1);
      if (row && row.platform !== "telegram") {
        throw new Error(
          `getOutreachWorkerClient: аккаунт ${account.id} платформы ${row.platform} — TDLib только для telegram`,
        );
      }
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
  // Cooldown в БД чистим best-effort: если выгоняем из-за banned/frozen, юзеру
  // потом надо будет re-auth — там точно не должно быть унаследованного
  // cooldown'а.
  await clearAccountCooldown(accountId).catch(() => {});
  detachListener(accountId, entry.client);
  entry.replicator.detach();
  entry.authBus.detach();
  try {
    await entry.client.close();
  } catch {
    // already closed
  }
}


import {
  attachAuthStateBus,
  type AuthStateBus,
} from "./auth-state";
import {
  createTdClient,
  destroyTdAccount,
  type TdAccountKey,
  type TdClient,
} from "./client";

// Pending-store для незавершённого auth-флоу (между HTTP-вызовами sendCode →
// signIn → signInPassword клиент должен выживать). На каждое (workspace|user)
// — один TdClient + AuthStateBus + TTL.
//
// При успехе persist-helper вызывает promote(), и инстанс перемещается в
// рабочий кэш (workerClients / personalClients). Либо при abandon (TTL,
// явный sign-out) — clear() закрывает клиент и стирает td-database/<key>/.

export type PendingEntry = {
  client: TdClient;
  authBus: AuthStateBus;
  key: TdAccountKey;
  // 2FA-пароль, который юзер ввёл в текущем auth-флоу. Хранится в RAM
  // только до конца persist'а (provisionIframeSession его пере-использует
  // когда второй TDLib-инстанс упирается в WaitPassword), потом стирается.
  // В БД НИКОГДА не уходит.
  lastPassword?: string;
};

export type PendingStore = {
  getOrCreate: () => Promise<PendingEntry>;
  // Снять контроль над клиентом — pending-store «забывает» клиента, дальше
  // им владеет рабочий кэш (worker/personal). Возвращает entry для caller'а.
  promote: () => PendingEntry | null;
  clear: () => Promise<void>;
};

const PENDING_TTL_MS = 5 * 60_000;

export function createPendingTdStore(opts: {
  resolveKey: () => TdAccountKey;
  deviceModel?: string;
}): PendingStore {
  let entry: PendingEntry | null = null;
  let inflight: Promise<PendingEntry> | null = null;
  let ttlTimer: ReturnType<typeof setTimeout> | null = null;

  function resetTtl(): void {
    if (ttlTimer) clearTimeout(ttlTimer);
    const t = setTimeout(() => {
      void clear();
    }, PENDING_TTL_MS);
    t.unref?.();
    ttlTimer = t;
  }

  async function getOrCreate(): Promise<PendingEntry> {
    if (entry) {
      resetTtl();
      return entry;
    }
    if (inflight) return inflight;
    inflight = (async () => {
      const key = opts.resolveKey();
      const client = createTdClient({ key, deviceModel: opts.deviceModel });
      const authBus = attachAuthStateBus(client);
      // Глушим default error-event tdl: если внутри handler'а падает —
      // tdl эмитит 'error', без подписчиков Node бросает unhandled.
      client.on("error", (e) => {
        console.error(`[tdlib pending] ${describeKey(key)}:`, e);
      });
      const e: PendingEntry = { client, authBus, key };
      entry = e;
      resetTtl();
      return e;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  function promote(): PendingEntry | null {
    if (!entry) return null;
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = null;
    }
    const e = entry;
    entry = null;
    return e;
  }

  async function clear(): Promise<void> {
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = null;
    }
    const e = entry;
    if (!e) return;
    entry = null;
    e.authBus.detach();
    try {
      await e.client.close();
    } catch {
      // close может упасть если client уже закрыт
    }
    // td-database/<key> — это начатый, но незавершённый auth. Никаких полезных
    // данных он не содержит, безопасно сносить.
    await destroyTdAccount(e.key).catch((err) => {
      console.error("[tdlib pending] destroy dir failed:", err);
    });
  }

  return {
    getOrCreate,
    promote,
    clear,
  };
}

function describeKey(key: TdAccountKey): string {
  switch (key.kind) {
    case "outreach":
      return `outreach:${key.accountId}`;
    case "personal":
      return `personal:${key.userId}`;
    case "raw":
      return `raw:${key.key}`;
  }
}

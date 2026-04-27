import { resolve } from "node:path";
import { rename, rm } from "node:fs/promises";
import * as tdl from "tdl";
import type { Client as TdlClient } from "tdl";
import { ensureTdlConfigured, tgApiHash, tgApiId } from "./configure";

// Базовый каталог под binlog'и + кэшированные файлы. Per-account подкаталог
// (key = accountId | personal-userId) — TDLib хранит auth-state, peer cache,
// pts/qts/seq для надёжной доставки updates. Persistent FS-state, в проде на
// volume.
//
// Дефолт `.td-database` — относительно cwd Bun-процесса (apps/api/), потому
// что pnpm dev запускает `bun run` из workspace root апи. В проде override
// через TDLIB_DATA_DIR — например, абсолютный путь смонтированного volume.
const DATA_ROOT = resolve(process.env.TDLIB_DATA_DIR ?? ".td-database");

export type TdClient = TdlClient;

export type TdAccountKey =
  | { kind: "outreach"; accountId: string }
  | { kind: "personal"; userId: string }
  | { kind: "raw"; key: string };

export function tdAccountDir(key: TdAccountKey): string {
  switch (key.kind) {
    case "outreach":
      return resolve(DATA_ROOT, "outreach", key.accountId);
    case "personal":
      return resolve(DATA_ROOT, "personal", key.userId);
    case "raw":
      return resolve(DATA_ROOT, key.key);
  }
}

export type CreateTdClientOptions = {
  key: TdAccountKey;
  // Имя устройства, видно юзеру в Settings → Devices Telegram. Используем чтобы
  // отличать outreach-аккаунты ("CRM Outreach") от personal ("CRM Sync").
  deviceModel?: string;
};

export function createTdClient(opts: CreateTdClientOptions): TdClient {
  ensureTdlConfigured();
  const dbDir = tdAccountDir(opts.key);
  return tdl.createClient({
    apiId: tgApiId,
    apiHash: tgApiHash,
    databaseDirectory: dbDir,
    filesDirectory: resolve(dbDir, "files"),
    // skipOldUpdates: пропустить весь backlog updates за время offline'а на
    // старте. Worker тут синкает unread через UpdateReadHistoryInbox/Outbox
    // в текущей сессии; перебирать историю incoming с прошлого месяца не нужно
    // (БД уже содержит финальное состояние). Заодно не воскрешает «непрочитанное»
    // у contact'ов, которое юзер уже руками обнулил.
    skipOldUpdates: true,
    tdlibParameters: {
      use_message_database: false,
      use_secret_chats: false,
      system_language_code: "en",
      device_model: opts.deviceModel ?? "CRM",
      application_version: "0.1.0",
    },
  });
}

// Закрытие через `client.close()` ждёт authorizationStateClosed. logOut
// дополнительно говорит TG-серверу убрать «активное устройство» — нужно при
// явном удалении аккаунта.
export async function destroyTdAccount(key: TdAccountKey): Promise<void> {
  await rm(tdAccountDir(key), { recursive: true, force: true });
}

// Перемещает binlog/files на другой ключ. Использовать только когда оба клиента
// (источника и назначения) гарантированно closed — иначе TDLib может писать в
// открытые fd на старом пути (на Linux fd следуют за inode, но на других FS
// поведение неопределённое).
export async function renameTdAccount(
  from: TdAccountKey,
  to: TdAccountKey,
): Promise<void> {
  await rename(tdAccountDir(from), tdAccountDir(to));
}


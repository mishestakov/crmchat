import { resolve } from "node:path";
import { rename, rm } from "node:fs/promises";
import * as tdl from "tdl";
import type { Client as TdlClient } from "tdl";
import { ensureTdlConfigured, tgApiHash, tgApiId } from "./configure.ts";

// Базовый каталог под binlog'и + кэшированные файлы. Per-account подкаталог
// (key = accountId) — TDLib хранит auth-state, peer cache, pts/qts/seq для
// надёжной доставки updates. Persistent FS-state, в проде на volume.
//
// Дефолт `.td-database` — относительно cwd Bun-процесса (apps/api/), потому
// что pnpm dev запускает `bun run` из workspace root апи. В проде override
// через TDLIB_DATA_DIR — например, абсолютный путь смонтированного volume.
const DATA_ROOT = resolve(process.env.TDLIB_DATA_DIR ?? ".td-database");

export type TdClient = TdlClient;

// outreach — постоянный outreach-аккаунт workspace'а (worker-инстанс).
// raw — временный ключ для коротких задач (provision iframe-сессии, и т.п.).
export type TdAccountKey =
  | { kind: "outreach"; accountId: string }
  | { kind: "raw"; key: string };

export function tdAccountDir(key: TdAccountKey): string {
  switch (key.kind) {
    case "outreach":
      return resolve(DATA_ROOT, "outreach", key.accountId);
    case "raw":
      return resolve(DATA_ROOT, key.key);
  }
}

export type CreateTdClientOptions = {
  key: TdAccountKey;
  // Имя устройства, видно юзеру в Settings → Devices Telegram.
  deviceModel?: string;
};

// Парсим MTProto-прокси-URL из @MTProxybot — поддерживаем оба формата,
// в которые TG приложение даёт «Share»: tg://proxy?... и https://t.me/proxy?...
// Включаем только когда заданы все три параметра.
function parseProxyUrl(
  raw: string | undefined | null,
): { server: string; port: number; secret: string } | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const isProxy =
      (u.protocol === "tg:" && u.host === "proxy") ||
      (u.host === "t.me" && u.pathname === "/proxy");
    if (!isProxy) return null;
    const server = u.searchParams.get("server") ?? "";
    const port = Number(u.searchParams.get("port") ?? "");
    const secret = u.searchParams.get("secret") ?? "";
    if (!server || !port || !secret) return null;
    return { server, port, secret };
  } catch {
    return null;
  }
}

export function createTdClient(opts: CreateTdClientOptions): TdClient {
  ensureTdlConfigured();
  const dbDir = tdAccountDir(opts.key);
  const client = tdl.createClient({
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

  // MTProto-прокси: addProxy идемпотентен (TDLib хранит в binlog), enable:true
  // переключает live-соединение. Fire-and-forget — addProxy не блокирует
  // authorization flow, а ошибка прокси не должна валить весь client.
  const proxy = parseProxyUrl(process.env.TG_PROXY_URL);
  if (proxy) {
    client
      .invoke({
        _: "addProxy",
        server: proxy.server,
        port: proxy.port,
        enable: true,
        type: { _: "proxyTypeMtproto", secret: proxy.secret },
      })
      .catch((e: unknown) =>
        console.error("[tdlib] addProxy failed:", e),
      );
  }

  return client;
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


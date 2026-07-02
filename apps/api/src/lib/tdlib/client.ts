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
// raw — временный ключ для коротких задач.
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
      // use_message_database: персистим чаты+сообщения между рестартами. По
      // td_api.tl:10583 ВКЛЮЧАЕТ по цепочке use_chat_info_database →
      // use_file_database (info о скачанных файлах тоже переживает рестарт).
      // Зачем: getChatHistory(only_local) отдаёт полную историю мгновенно и без
      // сети — фундамент для публичных read-only share-ссылок на переписку
      // (внешний эндпоинт НИКОГДА не дёргает MTProto → не абьюзят аккаунт) и для
      // будущего LLM-экспорта. Байты медиа лежат файлами в filesDirectory
      // (персистят благодаря implied use_file_database), но только после
      // реального downloadFile. Аддитивно к существующим data-dir: message DB
      // создастся и наполнится лениво при открытии чатов, re-auth не нужен.
      use_message_database: true,
      use_secret_chats: false,
      system_language_code: "en",
      device_model: opts.deviceModel ?? "CRM",
      application_version: "0.1.0",
    },
  });

  // MTProto-прокси: TDLib хранит список proxies в binlog между рестартами.
  // На каждый старт сверяем: если URL уже зарегистрирован — только включаем,
  // если новый — добавляем.
  const proxy = parseProxyUrl(process.env.TG_PROXY_URL);
  if (proxy) {
    void syncProxy(client, proxy).catch((e: unknown) =>
      console.error("[tdlib] proxy sync failed:", e),
    );
  }

  return client;
}

async function syncProxy(
  client: TdlClient,
  proxy: { server: string; port: number; secret: string },
): Promise<void> {
  const list = (await client.invoke({ _: "getProxies" })) as unknown as {
    proxies: Array<{
      id: number;
      server: string;
      port: number;
      is_enabled: boolean;
      type: { _: string; secret?: string };
    }>;
  };
  const match = list.proxies.find(
    (p) =>
      p.server === proxy.server &&
      p.port === proxy.port &&
      p.type._ === "proxyTypeMtproto" &&
      p.type.secret === proxy.secret,
  );
  if (match) {
    if (!match.is_enabled) {
      await client.invoke({ _: "enableProxy", proxy_id: match.id });
    }
    return;
  }
  // TDLib master сменил сигнатуру addProxy: теперь принимает proxy:proxy
  // объект вместо плоских server/port/type. Без вложенности TDLib
  // отвечает «Proxy must be non-empty».
  await client.invoke({
    _: "addProxy",
    proxy: {
      _: "proxy",
      server: proxy.server,
      port: proxy.port,
      type: { _: "proxyTypeMtproto", secret: proxy.secret },
    },
    enable: true,
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


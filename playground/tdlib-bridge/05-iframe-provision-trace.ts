// Стенд для воспроизведения нашего production-сценария provisionIframeSession
// БЕЗ любого UI/HTTP — только два TDLib инстанса в одном Node-процессе.
//
// Что делает:
//   1) Запускает worker-инстанс (использует `td-database/` после 01-tdlib-auth)
//      — это «уже-залогиненный» аккаунт. Если td-database пуст, скрипт
//      попросит сначала запустить 01.
//   2) Запускает второй (iframe) TDLib инстанс на временном dir
//      `td-database-iframe-trace-<ts>/` (анон).
//   3) iframe → requestQrCodeAuthentication, ждёт wait_qr.
//   4) Worker → confirmQrCodeAuthentication(link). Если у юзера 2FA, iframe
//      переходит в WaitPassword — спрашиваем пароль через input в консоли.
//   5) iframe доходит до Ready. Дампим:
//      • полный лог всех updates iframe-инстанса (timestamped)
//      • снимки optionCache iframe + worker'а
//      • попытки invoke('getOption') для home_dc_id, main_dc_id на iframe
//      • попытку invoke('getRawAuthKey') для каждого DC 1..5
//   6) Логи пишутся в trace.log + stdout. Потом этот файл смотрим вручную.
//
// Запуск:
//   eval "$(../../tools/tdlib/build.sh --env)" && pnpm tsx 05-iframe-provision-trace.ts

import { resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { appendFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import * as tdl from "tdl";
import input from "input";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

const LIBDIR = process.env.TDLIB_LIBDIR ?? "/home/mike/td/build";
if (!existsSync(`${LIBDIR}/libtdjson.so`)) {
  throw new Error(`libtdjson.so not found in ${LIBDIR}`);
}
tdl.configure({ tdjson: "libtdjson.so", libdir: LIBDIR });

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH!;
if (!apiId || !apiHash) {
  throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH not set");
}

const TS = Date.now();
const TRACE_PATH = resolve(import.meta.dirname, `trace-${TS}.log`);
const IFRAME_DB = resolve(import.meta.dirname, `td-database-iframe-trace-${TS}`);
const WORKER_DB = resolve(import.meta.dirname, "td-database");

if (!existsSync(WORKER_DB)) {
  throw new Error(
    `worker td-database/ отсутствует — сначала запусти 01-tdlib-auth.ts чтобы залогинить worker.`,
  );
}
mkdirSync(IFRAME_DB, { recursive: true });
writeFileSync(TRACE_PATH, `=== TDLib iframe-provision trace ${new Date().toISOString()} ===\n\n`);

function trace(prefix: string, msg: unknown) {
  const line = `[${new Date().toISOString()}] [${prefix}] ${
    typeof msg === "string" ? msg : JSON.stringify(msg)
  }`;
  console.log(line);
  appendFileSync(TRACE_PATH, line + "\n");
}

function makeClient(label: string, db: string) {
  return tdl.createClient({
    apiId,
    apiHash,
    databaseDirectory: db,
    filesDirectory: `${db}/files`,
    skipOldUpdates: true,
    tdlibParameters: {
      use_message_database: false,
      use_secret_chats: false,
      system_language_code: "en",
      device_model: label,
      application_version: "trace-0.1",
    },
  });
}

const worker = makeClient("CRM Outreach (trace)", WORKER_DB);
const iframe = makeClient("CRM iframe (trace)", IFRAME_DB);

worker.on("error", (e) => trace("worker.error", String(e)));
iframe.on("error", (e) => trace("iframe.error", String(e)));

const workerOptions: Record<string, unknown> = {};
const iframeOptions: Record<string, unknown> = {};
worker.on("update", (u: any) => {
  trace("worker.update", { _: u._, ...summarize(u) });
  if (u._ === "updateOption") {
    workerOptions[u.name] = u.value?.value ?? u.value;
  }
});
let qrLink = "";
iframe.on("update", (u: any) => {
  trace("iframe.update", { _: u._, ...summarize(u) });
  if (u._ === "updateOption") {
    iframeOptions[u.name] = u.value?.value ?? u.value;
  }
  if (
    u._ === "updateAuthorizationState" &&
    u.authorization_state?._ === "authorizationStateWaitOtherDeviceConfirmation"
  ) {
    qrLink = u.authorization_state.link ?? "";
  }
});

// Ужимаем большие update-объекты до полей, которые нас интересуют.
function summarize(u: any): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (u.authorization_state) o.authorization_state = u.authorization_state._;
  if (u.state) o.state = u.state._;
  if (u.name) o.name = u.name;
  if (u.value) o.value = u.value;
  if (u.link) o.link = u.link;
  return o;
}

async function awaitState(client: any, options: Record<string, unknown>, pred: (state: string) => boolean, timeoutMs = 30_000) {
  // Polling-style ожидание через iter — поскольку это спайк, не делаем bus.
  const deadline = Date.now() + timeoutMs;
  let lastState = "";
  while (Date.now() < deadline) {
    // не очень элегантно но достаточно для диагностики
    await new Promise((r) => setTimeout(r, 200));
    if (options.__authState && options.__authState !== lastState) {
      lastState = options.__authState as string;
      if (pred(lastState)) return lastState;
    }
  }
  throw new Error(`awaitState timeout, last=${lastState}`);
}

// Альтернатива: захватываем authState напрямую в options.__authState.
const setAuthListener = (client: any, options: Record<string, unknown>) => {
  client.on("update", (u: any) => {
    if (u._ === "updateAuthorizationState") {
      options.__authState = u.authorization_state._;
    }
  });
};
setAuthListener(worker, workerOptions);
setAuthListener(iframe, iframeOptions);

async function main() {
  trace("setup", { TRACE_PATH, IFRAME_DB, WORKER_DB });

  // 1) wake worker — getMe заставит его connect.
  trace("step", "worker getMe");
  const me = await worker.invoke({ _: "getMe" } as any);
  trace("worker.me", { id: (me as any).id, first_name: (me as any).first_name });
  trace("worker.options", workerOptions);

  // 2) iframe должен прийти в WaitPhoneNumber.
  trace("step", "iframe wait WaitPhoneNumber");
  await awaitState(iframe, iframeOptions, (s) => s === "authorizationStateWaitPhoneNumber");

  // 3) iframe → requestQrCodeAuthentication
  trace("step", "iframe requestQrCodeAuthentication");
  await iframe.invoke({ _: "requestQrCodeAuthentication", other_user_ids: [] } as any);
  await awaitState(iframe, iframeOptions, (s) => s === "authorizationStateWaitOtherDeviceConfirmation");

  // 4) worker → confirmQrCodeAuthentication(link). link сохраняется в qrLink
  // глобально через основной update-handler, так что к этому моменту он уже есть.
  for (let i = 0; i < 10 && !qrLink; i++) await new Promise((r) => setTimeout(r, 200));
  if (!qrLink) throw new Error("не получили link для QR");
  trace("step", { worker_confirm: qrLink });
  await worker.invoke({ _: "confirmQrCodeAuthentication", link: qrLink } as any);

  // 5) iframe должен пройти в Ready (с возможным WaitPassword посередине).
  trace("step", "iframe wait Ready (with possible WaitPassword)");
  while (true) {
    await new Promise((r) => setTimeout(r, 300));
    const s = iframeOptions.__authState as string | undefined;
    if (s === "authorizationStateReady") break;
    if (s === "authorizationStateWaitPassword") {
      trace("step", "iframe asks for 2FA password");
      const pwd = await input.password("2FA password: ");
      await iframe.invoke({ _: "checkAuthenticationPassword", password: pwd } as any);
    }
  }
  trace("iframe.options", iframeOptions);

  // 6) Принудительно тыкаем iframe online-методом, чтобы инициировать
  // MTProto-handshake к своему DC.
  trace("step", "iframe getMe (force online)");
  const iframeMe = await iframe.invoke({ _: "getMe" } as any);
  trace("iframe.me", { id: (iframeMe as any).id });

  // 7) Подождать чуть-чуть, чтобы collected updates пришли.
  await new Promise((r) => setTimeout(r, 2000));
  trace("iframe.options-after-getMe", iframeOptions);
  trace("worker.options-after-getMe", workerOptions);

  // 8) Пробуем getOption для всех известных DC-related опций на ОБОИХ.
  for (const name of ["home_dc_id", "main_dc_id", "session_count"]) {
    for (const [label, c] of [
      ["worker", worker],
      ["iframe", iframe],
    ] as const) {
      try {
        const v = await c.invoke({ _: "getOption", name } as any);
        trace(`${label}.getOption`, { name, value: v });
      } catch (e) {
        trace(`${label}.getOption.error`, { name, error: String(e) });
      }
    }
  }

  // 9) Перебираем DC 1..5 на iframe — ищем где у нас есть auth_key.
  for (let dc = 1; dc <= 5; dc++) {
    try {
      const r = (await iframe.invoke({ _: "getRawAuthKey", dc_id: dc } as any)) as any;
      const len = Buffer.isBuffer(r.auth_key)
        ? r.auth_key.length
        : Buffer.from(r.auth_key, "base64").length;
      trace("iframe.getRawAuthKey", { dc_id: dc, ok: true, key_len: len });
    } catch (e) {
      trace("iframe.getRawAuthKey", { dc_id: dc, ok: false, error: String(e) });
    }
  }
  // worker для контроля
  for (let dc = 1; dc <= 5; dc++) {
    try {
      const r = (await worker.invoke({ _: "getRawAuthKey", dc_id: dc } as any)) as any;
      const len = Buffer.isBuffer(r.auth_key)
        ? r.auth_key.length
        : Buffer.from(r.auth_key, "base64").length;
      trace("worker.getRawAuthKey", { dc_id: dc, ok: true, key_len: len });
    } catch (e) {
      trace("worker.getRawAuthKey", { dc_id: dc, ok: false, error: String(e) });
    }
  }

  trace("done", `trace written to ${TRACE_PATH}`);
}

main()
  .catch((e) => trace("fatal", String(e)))
  .finally(async () => {
    try {
      await iframe.close();
    } catch {}
    try {
      await worker.close();
    } catch {}
    await rm(IFRAME_DB, { recursive: true, force: true }).catch(() => undefined);
    process.exit(0);
  });

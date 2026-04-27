// Чистый эксперимент: можно ли получить рабочий auth_key для второй сессии
// через TDLib (pure-TDLib, без gramjs), при условии минимального race с
// другим клиентом. Поток:
//
//   1) iframe-инстанс (анон, td-database-iframe-trace/)
//   2) worker-инстанс (td-database/, должен быть pre-authed через `pnpm 01`)
//   3) iframe.requestQrCodeAuthentication → ждём WaitOtherDeviceConfirmation
//   4) worker.confirmQrCodeAuthentication(link)
//   5) worker.close() ← ВАЖНО: дальше iframe работает один, без race
//   6) iframe ждёт WaitPassword → checkAuthenticationPassword → ждёт Ready
//   7) iframe invoke getMe + getOption('home_dc_id'/'main_dc_id') + getRawAuthKey 1..5
//
// Логи в файл, stdout молчит (только финальный итог + path к log'у).
//
// Запуск (предварительно `pnpm 01` чтобы залогинить worker):
//   eval "$(../../tools/tdlib/build.sh --env)" && pnpm 06

import { resolve } from "node:path";
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
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
if (!apiId || !apiHash) throw new Error("TELEGRAM_API_ID / TELEGRAM_API_HASH not set");

const TS = Date.now();
const LOG = resolve(import.meta.dirname, `clean-${TS}.log`);
const IFRAME_DB = resolve(import.meta.dirname, `td-database-iframe-clean-${TS}`);
const WORKER_DB = resolve(import.meta.dirname, "td-database");
if (!existsSync(WORKER_DB)) {
  console.error(`worker td-database/ отсутствует — сначала pnpm 01.`);
  process.exit(1);
}
mkdirSync(IFRAME_DB, { recursive: true });
writeFileSync(LOG, `=== TDLib clean iframe-provision ${new Date().toISOString()} ===\n\n`);

function log(prefix: string, payload?: unknown): void {
  const line = `[${new Date().toISOString()}] [${prefix}]${
    payload === undefined ? "" : " " + (typeof payload === "string" ? payload : JSON.stringify(payload))
  }`;
  appendFileSync(LOG, line + "\n");
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
      application_version: "clean-0.1",
    },
  });
}

type AnyUpdate = { _: string; [k: string]: any };

function captureUpdates(client: any, label: "worker" | "iframe") {
  const events: AnyUpdate[] = [];
  const optionInts: Record<string, number> = {};
  let qrLink: string | null = null;
  let authState = "";
  client.on("error", (e: unknown) => log(`${label}.error`, String(e)));
  client.on("update", (u: AnyUpdate) => {
    events.push(u);
    if (u._ === "updateAuthorizationState") {
      authState = u.authorization_state?._ ?? "";
      log(`${label}.authState`, authState);
      if (authState === "authorizationStateWaitOtherDeviceConfirmation") {
        qrLink = u.authorization_state.link;
      }
    } else if (u._ === "updateConnectionState") {
      log(`${label}.connState`, u.state?._);
    } else if (u._ === "updateOption" && u.value?._ === "optionValueInteger") {
      optionInts[u.name] = Number(u.value.value);
      // Логируем только DC-relevant и my_id
      if (/dc_id|my_id|authorization_date/.test(u.name)) {
        log(`${label}.option`, { name: u.name, value: u.value.value });
      }
    }
  });
  return {
    events,
    optionInts,
    getQrLink: () => qrLink,
    getAuthState: () => authState,
  };
}

async function waitFor(
  pred: () => boolean,
  label: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`waitFor[${label}] timeout after ${timeoutMs}мс`);
}

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  let to: ReturnType<typeof setTimeout>;
  const t = new Promise<never>((_, rej) => {
    to = setTimeout(() => rej(new Error(`invoke[${label}] timeout after ${timeoutMs}мс`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, t]);
  } finally {
    clearTimeout(to!);
  }
}

const iframe = makeClient("CRM iframe (clean)", IFRAME_DB);
const worker = makeClient("CRM Outreach (clean)", WORKER_DB);
const iframeCap = captureUpdates(iframe, "iframe");
const workerCap = captureUpdates(worker, "worker");

async function main() {
  log("start", { LOG, IFRAME_DB });

  // Wake worker
  log("step", "worker getMe (wake)");
  const workerMe = (await withTimeout(worker.invoke({ _: "getMe" } as any), "worker.getMe", 30_000)) as any;
  log("worker.me", { id: workerMe.id });

  // iframe → WaitPhoneNumber
  log("step", "iframe wait WaitPhoneNumber");
  await waitFor(() => iframeCap.getAuthState() === "authorizationStateWaitPhoneNumber", "iframe.WaitPhoneNumber", 15_000);

  // requestQr
  log("step", "iframe requestQrCodeAuthentication");
  await withTimeout(
    iframe.invoke({ _: "requestQrCodeAuthentication", other_user_ids: [] } as any),
    "iframe.requestQr",
    15_000,
  );
  await waitFor(() => !!iframeCap.getQrLink(), "iframe.qrLink", 15_000);
  const link = iframeCap.getQrLink()!;
  log("step", { link });

  // worker confirms
  log("step", "worker confirmQrCodeAuthentication");
  await withTimeout(
    worker.invoke({ _: "confirmQrCodeAuthentication", link } as any),
    "worker.confirmQr",
    15_000,
  );
  log("step", "worker.close (release shared resources)");
  await withTimeout(worker.close(), "worker.close", 15_000);

  // iframe finalize: WaitPassword? Ready?
  log("step", "iframe wait WaitPassword|Ready");
  await waitFor(
    () =>
      iframeCap.getAuthState() === "authorizationStateReady" ||
      iframeCap.getAuthState() === "authorizationStateWaitPassword",
    "iframe.afterConfirm",
    60_000,
  );

  if (iframeCap.getAuthState() === "authorizationStateWaitPassword") {
    const pwd = await input.password("2FA password: ");
    log("step", "iframe checkAuthenticationPassword");
    await withTimeout(
      iframe.invoke({ _: "checkAuthenticationPassword", password: pwd } as any),
      "iframe.checkPwd",
      120_000,
    );
    log("step", "iframe wait Ready");
    await waitFor(
      () => iframeCap.getAuthState() === "authorizationStateReady",
      "iframe.Ready",
      120_000,
    );
  }

  // Force online
  log("step", "iframe getMe (force online)");
  const iframeMe = (await withTimeout(iframe.invoke({ _: "getMe" } as any), "iframe.getMe", 30_000)) as any;
  log("iframe.me", { id: iframeMe.id });

  // getOption по DC-relevant именам
  for (const name of ["home_dc_id", "main_dc_id", "my_id", "session_count"]) {
    try {
      const v = (await withTimeout(iframe.invoke({ _: "getOption", name } as any), `iframe.getOption.${name}`, 10_000)) as any;
      log("iframe.getOption", { name, value: v });
    } catch (e) {
      log("iframe.getOption.error", { name, error: String(e) });
    }
  }

  // getRawAuthKey 1..5
  for (let dc = 1; dc <= 5; dc++) {
    try {
      const r = (await withTimeout(
        iframe.invoke({ _: "getRawAuthKey", dc_id: dc } as any),
        `iframe.getRawAuthKey.${dc}`,
        10_000,
      )) as any;
      const len = Buffer.isBuffer(r.auth_key)
        ? r.auth_key.length
        : Buffer.from(r.auth_key, "base64").length;
      log("iframe.getRawAuthKey.ok", { dc, len, head: Buffer.isBuffer(r.auth_key) ? r.auth_key.subarray(0, 4).toString("hex") : "" });
    } catch (e) {
      log("iframe.getRawAuthKey.fail", { dc, error: String(e) });
    }
  }

  log("done", { LOG });
}

main()
  .catch((e) => {
    log("fatal", e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  })
  .finally(async () => {
    try {
      await iframe.close();
    } catch {}
    try {
      await worker.close();
    } catch {}
    await rm(IFRAME_DB, { recursive: true, force: true }).catch(() => undefined);
    console.log(`log: ${LOG}`);
    process.exit(0);
  });

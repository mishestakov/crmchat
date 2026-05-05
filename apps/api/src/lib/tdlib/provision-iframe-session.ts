import { attachAuthStateBus, waitForAuthState } from "./auth-state";
import {
  createTdClient,
  destroyTdAccount,
  type TdAccountKey,
  type TdClient,
} from "./client";
import { type TwaSession } from "./to-twa-session";

type TdRawAuthKey = {
  _: "authKeyData";
  dc_id: number;
  auth_key: Buffer | Uint8Array | string;
};

// TDL (node-обёртка) сериализует TL-поле `bytes` как base64-строку, а не raw
// Buffer. Если просто Buffer.from(value as Uint8Array) — оно интерпретирует
// строку как utf8 и даёт 344 байта (256/3*4 ровно), вместо 256. См. также
// playground/04-getRawAuthKey.ts (там этот fallback уже стоял, но в
// production-коде потеряли при миграции gramjs→TDLib).
function toAuthKeyBuffer(value: Buffer | Uint8Array | string): Buffer {
  if (typeof value === "string") return Buffer.from(value, "base64");
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value);
}

// home_dc_id хостится только у авторизованного клиента (worker). У свежего
// iframe-инстанса getOption("home_dc_id") отдаёт optionValueEmpty (проверено
// playground/06). Worker и iframe — один и тот же TG-аккаунт, значит home_dc
// общий: спрашиваем worker, потом дёргаем getRawAuthKey строго для этого DC.
async function getHomeDcId(workerClient: TdClient): Promise<number> {
  const opt = (await workerClient.invoke({
    _: "getOption",
    name: "home_dc_id",
  } as never)) as { _: "optionValueInteger"; value: string | number } | { _: "optionValueEmpty" };
  if (opt._ !== "optionValueInteger") {
    throw new Error(`worker getOption(home_dc_id) → ${opt._}, ожидали optionValueInteger`);
  }
  const dcId = typeof opt.value === "string" ? Number(opt.value) : opt.value;
  if (!Number.isInteger(dcId) || dcId < 1 || dcId > 5) {
    throw new Error(`home_dc_id вне диапазона 1..5: ${dcId}`);
  }
  return dcId;
}

async function getAuthKeyForDc(client: TdClient, dcId: number): Promise<Buffer> {
  const r = (await client.invoke({
    _: "getRawAuthKey",
    dc_id: dcId,
  } as never)) as TdRawAuthKey;
  return toAuthKeyBuffer(r.auth_key);
}

// ВТОРОЙ auth_key на тот же TG-аккаунт, специально для TWA-iframe в браузере.
// Один auth_key для worker (TDLib) + iframe (TWA) не годится: TG распределяет
// updates на активную сессию, и при открытом iframe worker молчит — теряем
// NewMessage / readInbox / readOutbox.
//
// Поток: anon TDLib-инстанс → requestQrCodeAuthentication → worker делает
// confirmQrCodeAuthentication, получает Session-объект (TL:10692 → Session) и
// возвращает его id наверх для точечного terminateSession при удалении
// аккаунта. При 2FA TG требует SRP-проверку даже от confirmed-устройства;
// переюзаем `password` (RAM-only из pending.lastPassword). Финал:
// getRawAuthKey строго для home_dc (worker'овского) → TwaSession.
//
// pauseWorker вызывается ИСКЛЮЧИТЕЛЬНО на 2FA-ветке — TDLib не переваривает
// параллельные клиенты на одном TG-аккаунте во время checkAuthenticationPassword
// второго инстанса (playground/05 vs 06). На non-2FA пути worker не трогаем,
// поэтому caller вызывает re-spawn только если pauseWorker вернул true.
export type IframeProvisionResult = {
  twa: TwaSession;
  // session_id новой iframe-сессии (TG int64 → строка для безопасности
  // от потери точности в JS Number). Используется при deleteOutreachAccount
  // для точечного terminateSession({session_id}) — без перебора getActiveSessions
  // и fragile match'a по device_model.
  sessionId: string;
};

export async function provisionIframeSession(
  workerClient: TdClient,
  accountId: string,
  password: string | undefined,
  pauseWorker: () => Promise<void>,
): Promise<IframeProvisionResult> {
  const tmpKey: TdAccountKey = {
    kind: "raw",
    key: `outreach/${accountId}/iframe-tmp-${Date.now()}`,
  };
  const iframeClient = createTdClient({
    key: tmpKey,
    deviceModel: "CRM iframe",
  });
  const authBus = attachAuthStateBus(iframeClient);
  iframeClient.on("error", (e) =>
    console.error(`[provisionIframeSession] tdlib error:`, e),
  );

  try {
    await waitForAuthState(
      authBus,
      (s) => s.kind === "wait_phone_or_qr" || s.kind === "wait_qr",
      15_000,
    );

    if (authBus.current().kind === "wait_phone_or_qr") {
      await iframeClient.invoke({
        _: "requestQrCodeAuthentication",
        other_user_ids: [],
      } as never);
    }

    const qr = await waitForAuthState(
      authBus,
      (s) => s.kind === "wait_qr",
      15_000,
    );
    if (qr.kind !== "wait_qr") {
      throw new Error(`unexpected iframe state: ${qr.kind}`);
    }

    // home_dc определяем у worker'а ДО confirmQrCodeAuthentication — после
    // confirm worker может продолжить работать параллельно (на non-2FA пути),
    // но в этот момент он точно ready и опция выставлена.
    const homeDcId = await getHomeDcId(workerClient);

    const confirmedSession = (await workerClient.invoke({
      _: "confirmQrCodeAuthentication",
      link: qr.link,
    } as never)) as { _: "session"; id: string | number };
    const sessionId = String(confirmedSession.id);

    const next = await waitForAuthState(
      authBus,
      (s) => s.kind === "ready" || s.kind === "wait_password",
      30_000,
    );
    if (next.kind === "wait_password") {
      if (!password) {
        throw new Error(
          "iframe TDLib просит 2FA-пароль, а у нас его нет в pending",
        );
      }
      // Без паузы worker'а checkAuthenticationPassword виснет на минуты под
      // catchup-spam'ом (playground/05).
      await pauseWorker();
      await iframeClient.invoke({
        _: "checkAuthenticationPassword",
        password,
      } as never);
      await waitForAuthState(authBus, (s) => s.kind === "ready", 30_000);
    }

    const authKey = await getAuthKeyForDc(iframeClient, homeDcId);
    return {
      twa: {
        mainDcId: homeDcId,
        keys: { [homeDcId]: authKey.toString("hex") },
      },
      sessionId,
    };
  } finally {
    authBus.detach();
    try {
      await iframeClient.close();
    } catch {
      // ignore
    }
    await destroyTdAccount(tmpKey).catch(() => undefined);
  }
}

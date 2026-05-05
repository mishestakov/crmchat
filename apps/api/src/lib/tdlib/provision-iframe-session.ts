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

// home_dc_id для второго (multi-device) TDLib-инстанса не публикуется ни через
// updateOption, ни через getOption (проверено в playground/06 — после Ready там
// optionValueEmpty). Зато наш патч `getRawAuthKey dc_id` отдаёт 256 байт для
// DC1 (bootstrap-сервер) и для home_dc, на остальных DC — 404. Перебираем
// DC2..5 (DC1 — это auth-server, TWA с ним не работает), первый успешный = home_dc.
async function findHomeDc(
  client: TdClient,
): Promise<{ dcId: number; authKey: Buffer }> {
  for (let dc = 2; dc <= 5; dc++) {
    try {
      const r = (await client.invoke({
        _: "getRawAuthKey",
        dc_id: dc,
      } as never)) as TdRawAuthKey;
      const authKey = toAuthKeyBuffer(r.auth_key);
      if (authKey.length !== 256) {
        throw new Error(
          `getRawAuthKey DC${dc}: expected 256-byte auth_key, got ${authKey.length}`,
        );
      }
      return { dcId: dc, authKey };
    } catch {
      // 404 — норма для DC без auth_key, идём к следующему.
    }
  }
  throw new Error("getRawAuthKey: ни один DC2..5 не отдал auth_key");
}

// ВТОРОЙ auth_key на тот же TG-аккаунт, специально для TWA-iframe в браузере.
// Один auth_key для worker (TDLib) + iframe (TWA) не годится: TG распределяет
// updates на активную сессию, и при открытом iframe worker молчит — теряем
// NewMessage / readInbox / readOutbox.
//
// Поток: anon TDLib-инстанс → requestQrCodeAuthentication → worker делает
// confirmQrCodeAuthentication. При 2FA TG требует SRP-проверку даже от
// confirmed-устройства; переюзаем `password` (RAM-only из pending.lastPassword).
// Финал: getRawAuthKey 2..5 → TwaSession. device_model="CRM iframe" нужен,
// чтобы при delete account найти эту сессию через getActiveSessions.
//
// pauseWorker вызывается ИСКЛЮЧИТЕЛЬНО на 2FA-ветке — TDLib не переваривает
// параллельные клиенты на одном TG-аккаунте во время checkAuthenticationPassword
// второго инстанса (playground/05 vs 06). На non-2FA пути worker не трогаем,
// поэтому caller вызывает re-spawn только если pauseWorker вернул true.
export async function provisionIframeSession(
  workerClient: TdClient,
  accountId: string,
  password: string | undefined,
  pauseWorker: () => Promise<void>,
): Promise<TwaSession> {
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

    await workerClient.invoke({
      _: "confirmQrCodeAuthentication",
      link: qr.link,
    } as never);

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

    const { dcId, authKey } = await findHomeDc(iframeClient);
    return {
      mainDcId: dcId,
      keys: { [dcId]: authKey.toString("hex") },
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

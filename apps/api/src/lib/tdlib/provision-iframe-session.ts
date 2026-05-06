import { attachAuthStateBus, waitForAuthState } from "./auth-state.ts";
import {
  createTdClient,
  destroyTdAccount,
  type TdAccountKey,
  type TdClient,
} from "./client.ts";
import { type TwaSession } from "./to-twa-session.ts";

// tdl обменивается с tdjson через JSON-строки (tdl/addon/td.cpp + dist/client.js
// JSON.stringify/parse), а td_json_client сериализует TL-поле `bytes` как
// base64-строку. Значит auth_key на runtime — всегда string, никогда не Buffer
// и не Uint8Array. Раньше код делал Buffer.from(value) без encoding — это
// трактовало base64-string как utf8 и давало 344 байта вместо 256.
type TdAuthKeyData = { dc_id: number; auth_key: string };
type TdMtprotoSession = {
  _: "mtprotoSession";
  main_dc_id: number;
  keys: TdAuthKeyData[];
};

// Атомарный снимок MTProto-state через наш TDLib-патч
// (tools/tdlib/patches/0001-add-mtproto-extensions.patch). До патча
// перебирали dc 1..5 и угадывали main по «первому успешному» — это ломалось
// если у iframe handshake'нулось несколько DC. Теперь TDLib сам говорит
// main_dc_id + отдаёт ключи всех негоциированных DC.
async function fetchMtprotoSession(
  client: TdClient,
): Promise<{ mainDcId: number; keys: Record<number, string> }> {
  const r = (await client.invoke({
    _: "getMtprotoSession",
  } as never)) as TdMtprotoSession;
  const keys: Record<number, string> = {};
  for (const k of r.keys) {
    keys[k.dc_id] = Buffer.from(k.auth_key, "base64").toString("hex");
  }
  return { mainDcId: r.main_dc_id, keys };
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
// getMtprotoSession на iframe → TwaSession (main_dc_id + все DC keys).
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

    const { mainDcId, keys } = await fetchMtprotoSession(iframeClient);
    return {
      twa: { mainDcId, keys },
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

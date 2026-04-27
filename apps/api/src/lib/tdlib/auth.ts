import { waitForAuthState } from "./auth-state";
import type { PendingEntry } from "./pending-store";

// HTTP-уровневый auth-флоу поверх TDLib state-machine. Каждый helper делает
// один invoke и дожидается следующего стабильного auth-state, мапя его в
// дискретный результат, который route отдаёт фронту.
//
// TDLib сама держит phone_code_hash, делает SRP при 2FA, и сама переключает
// DC при QR-migration — нам остаётся только дёрнуть нужный метод и прочитать
// state.

const STEP_TIMEOUT_MS = 15_000;

export type SendCodeResult = { isCodeViaApp: boolean };

export async function tdSendCode(
  pending: PendingEntry,
  phoneNumber: string,
): Promise<SendCodeResult> {
  await ensureWaitPhoneOrQr(pending);
  await pending.client.invoke({
    _: "setAuthenticationPhoneNumber",
    phone_number: phoneNumber,
  } as never);
  const next = await waitForAuthState(
    pending.authBus,
    (s) =>
      s.kind === "wait_code" ||
      s.kind === "wait_password" ||
      s.kind === "ready" ||
      s.kind === "wait_registration",
    STEP_TIMEOUT_MS,
  );
  if (next.kind !== "wait_code") {
    // password_needed без кода = у юзера 2FA уже кэширована, не наш сценарий.
    // Бросаем — фронт увидит 400 с понятным текстом.
    throw new Error(`unexpected post-sendCode state: ${next.kind}`);
  }
  return { isCodeViaApp: next.isCodeViaApp };
}

export type SignInResult =
  | { kind: "ok" }
  | { kind: "password_needed" }
  | { kind: "phone_code_invalid" }
  | { kind: "user_not_found" };

export async function tdSignInCode(
  pending: PendingEntry,
  phoneCode: string,
): Promise<SignInResult> {
  try {
    await pending.client.invoke({
      _: "checkAuthenticationCode",
      code: phoneCode,
    } as never);
  } catch (e) {
    if (isTdlibError(e, "PHONE_CODE_INVALID") || isTdlibError(e, "PHONE_CODE_EXPIRED")) {
      return { kind: "phone_code_invalid" };
    }
    throw e;
  }
  const next = await waitForAuthState(
    pending.authBus,
    (s) =>
      s.kind === "ready" ||
      s.kind === "wait_password" ||
      s.kind === "wait_registration",
    STEP_TIMEOUT_MS,
  );
  if (next.kind === "wait_password") return { kind: "password_needed" };
  if (next.kind === "wait_registration") return { kind: "user_not_found" };
  return { kind: "ok" };
}

export type SignInPasswordResult =
  | { kind: "ok" }
  | { kind: "password_invalid" };

export async function tdSignInPassword(
  pending: PendingEntry,
  password: string,
): Promise<SignInPasswordResult> {
  try {
    await pending.client.invoke({
      _: "checkAuthenticationPassword",
      password,
    } as never);
  } catch (e) {
    if (isTdlibError(e, "PASSWORD_HASH_INVALID")) {
      return { kind: "password_invalid" };
    }
    throw e;
  }
  await waitForAuthState(
    pending.authBus,
    (s) => s.kind === "ready",
    STEP_TIMEOUT_MS,
  );
  // Запоминаем пароль в pending — provisionIframeSession переюзает его,
  // если у юзера 2FA включена и второй TDLib-инстанс упирается в WaitPassword.
  pending.lastPassword = password;
  return { kind: "ok" };
}

// QR-флоу: запросить link и отдать его SSE-стриму. TDLib сам ротирует QR
// при истечении (повторный update authStateWaitOtherDeviceConfirmation
// со свежим link'ом) — bus прокинет следующий state наверх.
export async function tdRequestQr(pending: PendingEntry): Promise<void> {
  await ensureWaitPhoneOrQr(pending);
  // Если повторно зашли на qr-stream и тот же pending уже сидит в wait_qr —
  // второй requestQrCodeAuthentication TDLib отвергает с "unexpected".
  // Идемпотентно скипаем — текущий link уже в bus.current().
  const s = pending.authBus.current();
  if (s.kind === "wait_qr" || s.kind === "wait_password" || s.kind === "ready") {
    return;
  }
  await pending.client.invoke({
    _: "requestQrCodeAuthentication",
    other_user_ids: [],
  } as never);
}

// Привести TDLib к состоянию wait_phone_or_qr. Свежий клиент проходит
// wait_tdlib_parameters очень быстро (tdl сам шлёт setTdlibParameters), но
// это асинхронно — гарантируем перед invoke'ом сетапа.
async function ensureWaitPhoneOrQr(pending: PendingEntry): Promise<void> {
  const s = pending.authBus.current();
  if (
    s.kind === "wait_phone_or_qr" ||
    s.kind === "wait_qr" ||
    s.kind === "wait_code" ||
    s.kind === "wait_password"
  ) {
    return;
  }
  await waitForAuthState(
    pending.authBus,
    (s) =>
      s.kind === "wait_phone_or_qr" ||
      s.kind === "wait_qr" ||
      s.kind === "wait_code" ||
      s.kind === "wait_password" ||
      s.kind === "ready",
    STEP_TIMEOUT_MS,
  );
}

// tdl бросает ошибки TDLib как Error с message `<code>: <message>` (например
// "400: PHONE_CODE_INVALID"). Матчим по substring.
function isTdlibError(e: unknown, msg: string): boolean {
  if (!e) return false;
  const text = e instanceof Error ? e.message : String(e);
  return text.includes(msg);
}

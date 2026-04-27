import type { TdClient } from "./client";

// Низкоуровневая обёртка вокруг updateAuthorizationState. TDLib эмитит этот
// update при каждой смене состояния auth state-machine — от
// `authorizationStateWaitTdlibParameters` (стартует пустой клиент) до
// `authorizationStateReady` (готов к работе) или `authorizationStateClosed`.
//
// Вместо tdl.login() (которое — high-level CLI flow с input prompt'ами) мы
// сами читаем state и в HTTP-ручках invoke'аем нужный метод (sendCode →
// setAuthenticationPhoneNumber, signIn → checkAuthenticationCode, etc).

export type AuthState =
  // Сразу после createClient — TDLib ещё не получил setTdlibParameters.
  // tdl делает это сам из ClientOptions, так что эта стадия очень короткая.
  | { kind: "wait_tdlib_parameters" }
  // Готов принять номер телефона ИЛИ QR (через requestQrCodeAuthentication).
  | { kind: "wait_phone_or_qr" }
  // QR-флоу: TDLib сгенерил qr-link, ждём подтверждения с другого устройства.
  | { kind: "wait_qr"; link: string }
  // Phone-флоу: SMS/TG-app код запрошен, ждём checkAuthenticationCode.
  | { kind: "wait_code"; isCodeViaApp: boolean }
  // 2FA: ждём checkAuthenticationPassword.
  | { kind: "wait_password" }
  // Бессигнальный регистрационный sign-up (мы его не поддерживаем).
  | { kind: "wait_registration" }
  | { kind: "ready" }
  | { kind: "logging_out" }
  | { kind: "closed" };

type RawAuthState = { _: string; [key: string]: unknown };

function parseAuthState(raw: RawAuthState): AuthState {
  switch (raw._) {
    case "authorizationStateWaitTdlibParameters":
    case "authorizationStateWaitEncryptionKey":
      return { kind: "wait_tdlib_parameters" };
    case "authorizationStateWaitPhoneNumber":
      return { kind: "wait_phone_or_qr" };
    case "authorizationStateWaitOtherDeviceConfirmation":
      return { kind: "wait_qr", link: String(raw.link ?? "") };
    case "authorizationStateWaitCode": {
      const info = (raw.code_info ?? {}) as { type?: { _?: string } };
      const isCodeViaApp =
        info.type?._ === "authenticationCodeTypeTelegramMessage";
      return { kind: "wait_code", isCodeViaApp };
    }
    case "authorizationStateWaitPassword":
      return { kind: "wait_password" };
    case "authorizationStateWaitRegistration":
      return { kind: "wait_registration" };
    case "authorizationStateReady":
      return { kind: "ready" };
    case "authorizationStateLoggingOut":
      return { kind: "logging_out" };
    case "authorizationStateClosing":
    case "authorizationStateClosed":
      return { kind: "closed" };
    default:
      return { kind: "wait_tdlib_parameters" };
  }
}

// Слушает updateAuthorizationState и поддерживает .current() + push'ит подписчикам.
// Один такой helper создаётся per pending TdClient; после persist'а аккаунта
// слушатель остаётся (важен для outreach-listener — там же ловятся
// LoggedOut → mark unauthorized).
export type AuthStateBus = {
  current: () => AuthState;
  subscribe: (cb: (s: AuthState) => void) => () => void;
  detach: () => void;
};

export function attachAuthStateBus(client: TdClient): AuthStateBus {
  let current: AuthState = { kind: "wait_tdlib_parameters" };
  const subs = new Set<(s: AuthState) => void>();

  const handler = (update: unknown) => {
    if (
      !update ||
      typeof update !== "object" ||
      (update as { _?: string })._ !== "updateAuthorizationState"
    ) {
      return;
    }
    const raw = (update as { authorization_state: RawAuthState })
      .authorization_state;
    const next = parseAuthState(raw);
    current = next;
    for (const cb of subs) {
      try {
        cb(next);
      } catch {
        // никогда не ронять loop из-за подписчика
      }
    }
  };
  client.on("update", handler);

  return {
    current: () => current,
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    detach: () => {
      client.off("update", handler);
      subs.clear();
    },
  };
}

// Хелпер: дождаться что auth-state удовлетворяет предикату (с таймаутом).
// Используется в HTTP-ручках после invoke'а — например, после
// checkAuthenticationCode хотим точку, в которой known: либо ready, либо
// wait_password, либо ошибка.
export function waitForAuthState(
  bus: AuthStateBus,
  pred: (s: AuthState) => boolean,
  timeoutMs = 15_000,
): Promise<AuthState> {
  if (pred(bus.current())) return Promise.resolve(bus.current());
  return new Promise<AuthState>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("auth-state wait timed out"));
    }, timeoutMs);
    timer.unref?.();
    const unsub = bus.subscribe((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        unsub();
        resolve(s);
      }
    });
  });
}

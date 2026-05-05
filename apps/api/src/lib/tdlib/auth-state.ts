import type { TdClient } from "./client";

// Низкоуровневая обёртка вокруг updateAuthorizationState. TDLib эмитит этот
// update при каждой смене состояния auth state-machine — от
// `authorizationStateWaitTdlibParameters` (стартует пустой клиент) до
// `authorizationStateReady` (готов к работе) или `authorizationStateClosed`.
//
// Вместо tdl.login() (которое — high-level CLI flow с input prompt'ами) мы
// сами читаем state и в HTTP-ручках invoke'аем нужный метод (sendCode →
// setAuthenticationPhoneNumber, signIn → checkAuthenticationCode, etc).

// Полный список AuthorizationState — td_api.tl:155-207. Парсим только те, что
// возникают в наших флоу (phone-code, QR, 2FA, lifecycle). Email-auth и
// premium-purchase в наших сценариях не должны приходить — если приходят,
// это аномалия (TDLib что-то сменил, или мы случайно зацепили чужой флоу),
// и она должна быть видна в логах, не маскироваться silent default'ом.
export type AuthState =
  // Стартовое состояние; tdl сам шлёт setTdlibParameters через ClientOptions.
  | { kind: "wait_tdlib_parameters" }
  // td_api.tl:159 — готов принять номер телефона ИЛИ QR (через requestQrCodeAuthentication).
  | { kind: "wait_phone_or_qr" }
  // td_api.tl:183 — TDLib сгенерил qr-link, ждём подтверждения с другого устройства.
  | { kind: "wait_qr"; link: string }
  // td_api.tl:180 — SMS/TG-app код запрошен, ждём checkAuthenticationCode.
  | { kind: "wait_code"; isCodeViaApp: boolean }
  // td_api.tl:194 — 2FA: ждём checkAuthenticationPassword.
  | { kind: "wait_password" }
  // td_api.tl:186 — sign-up (новый юзер), мы не поддерживаем.
  | { kind: "wait_registration" }
  // td_api.tl:197.
  | { kind: "ready" }
  // td_api.tl:200.
  | { kind: "logging_out" }
  // td_api.tl:203 + 207 — Closing/Closed схлопываем в одно состояние.
  | { kind: "closed" }
  // Любой неизвестный/неподдерживаемый authorizationState* (см. default-ветку
  // ниже). Логируется error'ом — caller'у уйдёт в timeout.
  | { kind: "unknown"; raw: string };

type RawAuthState = { _: string; [key: string]: unknown };

function parseAuthState(raw: RawAuthState): AuthState {
  switch (raw._) {
    case "authorizationStateWaitTdlibParameters":
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
      console.error(
        `[tdlib auth-state] unsupported authorizationState: ${raw._}`,
      );
      return { kind: "unknown", raw: raw._ };
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
  const { promise, resolve, reject } = Promise.withResolvers<AuthState>();
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
  return promise;
}

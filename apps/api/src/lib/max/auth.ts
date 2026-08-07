// Авторизация MAX. Источник правды по флоу — `~/MAX/src/jobs/get-session.ts`
// (подтверждён живой пробой, см. project_max_integration). Сессия аккаунта =
// { deviceId, loginToken } — без FS-состояния, в отличие от TDLib; хранится
// строкой в БД (outreach_accounts.session_token + meta.deviceId).
import crypto from "node:crypto";
import { MaxClient } from "./client.ts";

// User-Agent живого клиента MAX. Версия важна вдвойне: сервер режет устаревшие билды,
// а поле `mode` в AUTH_REQUEST (integrity-подпись, см. compute-mode.ts) считается из
// файлов КОНКРЕТНОЙ сборки APK. Поэтому appVersion/buildNumber ОБЯЗАНЫ совпадать с версией,
// из которой сняты mode-константы (MODE_CONSTS/DEFAULT_MODE_BUILD в compute-mode.ts) — 26.26.0 / 6797.
//
// Поля собираются как в приложении (smali/cgf.smali + mei.smali декомпиляции):
//   osVersion  = String.format("Android %s", Build.VERSION.RELEASE)
//   deviceName = Build.MANUFACTURER + " " + Build.MODEL
//   screen     = "<densityBucket> <densityDpi>dpi <width>x<height>"
//   locale / deviceLocale = язык без региона; release приложение не отправляет.
export const MAX_USER_AGENT = {
  deviceType: "ANDROID",
  pushDeviceType: "GCM",
  appVersion: "26.26.0",
  arch: "arm64-v8a",
  buildNumber: 6797,
  osVersion: "Android 17",
  locale: "ru",
  deviceLocale: "ru",
  deviceName: "Google Pixel 9 Pro",
  screen: "360dpi 360dpi 960x2142",
  timezone: "Europe/Moscow",
} as const;

export interface MaxSession {
  deviceId: string;
  loginToken: string;
}

export function newDeviceId(): string {
  return crypto.randomUUID();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

// loginToken лежит в tokenAttrs.LOGIN.token ответа AUTH / AUTH_LOGIN_CHECK_PASSWORD.
export function pickLoginToken(payload: unknown): string | null {
  const tokenAttrs = asRecord(asRecord(payload)?.tokenAttrs);
  const login = asRecord(tokenAttrs?.LOGIN);
  const token = login?.token;
  return typeof token === "string" ? token : null;
}

// Ответ AUTH при включённом на аккаунте пароле (2FA) вместо tokenAttrs.LOGIN
// отдаёт passwordChallenge: { trackId, hint, email }. Разбор ответа —
// smali_classes3/tc0.smali в декомпиле приложения 26.26.0.
// hint задаёт сам пользователь при включении 2FA, поэтому он может отсутствовать
// или быть пустым — тогда показывать в UI нечего.
export function pickPasswordChallenge(
  payload: unknown,
): { trackId: string; hint: string | null } | null {
  const challenge = asRecord(asRecord(payload)?.passwordChallenge);
  const trackId = challenge?.trackId;
  if (typeof trackId !== "string") return null;
  const hint = typeof challenge?.hint === "string" ? challenge.hint : "";
  return { trackId, hint: hint.length > 0 ? hint : null };
}

// callsSeed из ответа SESSION_INIT нужен для вычисления `mode` (см. compute-mode.ts).
export async function sessionInit(
  client: MaxClient,
  deviceId: string,
): Promise<{ callsSeed: string | null }> {
  const res = await client.sessionInit({
    userAgent: MAX_USER_AGENT,
    deviceId,
    clientSessionId: BigInt(Date.now()),
  });
  const seed = asRecord(res.payload)?.callsSeed;
  return { callsSeed: seed == null ? null : String(seed) };
}

// Реконнект уже авторизованного аккаунта: новый сокет → SESSION_INIT → LOGIN.
export async function connectSession(client: MaxClient, session: MaxSession): Promise<void> {
  await client.connect();
  await sessionInit(client, session.deviceId);
  await client.login(session.loginToken);
}

export function selfIdFromLogin(loginPayload: unknown): string | null {
  const profile = asRecord(asRecord(loginPayload)?.profile);
  const contact = asRecord(profile?.contact);
  const id = contact?.id;
  return id != null ? String(id) : null;
}

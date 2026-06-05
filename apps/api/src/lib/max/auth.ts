// Авторизация MAX. Источник правды по флоу — `~/MAX/src/jobs/get-session.ts`
// (подтверждён живой пробой, см. project_max_integration). Сессия аккаунта =
// { deviceId, loginToken } — без FS-состояния, в отличие от TDLib; хранится
// строкой в БД (outreach_accounts.session_token + meta.deviceId).
import crypto from "node:crypto";
import { MaxClient } from "./client.ts";

// User-Agent одного из живых клиентов MAX. Версия важна — сервер может резать
// устаревшие билды. Держим централизованно, чтобы обновлять в одном месте.
export const MAX_USER_AGENT = {
  deviceType: "ANDROID",
  pushDeviceType: "GCM",
  appVersion: "26.7.1",
  arch: "arm64-v8a",
  buildNumber: 6583,
  osVersion: "Android 14",
  locale: "ru_RU",
  deviceLocale: "ru_RU",
  deviceName: "Pixel 8",
  screen: "1080x2400",
  timezone: "Europe/Moscow",
  release: 1,
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

// passwordChallenge.trackId присутствует когда на аккаунте включён пароль (2FA).
export function pickPasswordTrackId(payload: unknown): string | null {
  const challenge = asRecord(asRecord(payload)?.passwordChallenge);
  const trackId = challenge?.trackId;
  return typeof trackId === "string" ? trackId : null;
}

export async function sessionInit(client: MaxClient, deviceId: string): Promise<void> {
  await client.sessionInit({
    userAgent: MAX_USER_AGENT,
    deviceId,
    clientSessionId: BigInt(Date.now()),
  });
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

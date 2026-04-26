import { Api, type TelegramClient } from "telegram";
import { computeCheck } from "telegram/Password";
import { errMsg } from "./errors";
import {
  exportLoginTokenCached,
  type QrCacheKey,
} from "./qr-token-cache";

// Общий MTProto-флоу авторизации, разделяемый user-scoped (/v1/telegram/auth/*)
// и workspace-scoped (/v1/workspaces/{wsId}/outreach/accounts/auth/*) ручками.
// Разница между ними сводится к (а) где лежит pending-клиент + cache-key и
// (б) что делать после успеха (persistSession vs persistOutreachAccount). Всё
// остальное — TG-протокол, и должно быть в одном месте.

export type TgPendingHelpers = {
  getPending: () => Promise<TelegramClient>;
  clearPending: () => Promise<void>;
  cacheKey: QrCacheKey;
};

export type TgSendCodeResult = {
  phoneCodeHash: string;
  isCodeViaApp: boolean;
};

export async function tgSendCode(
  h: TgPendingHelpers,
  apiId: number,
  apiHash: string,
  phoneNumber: string,
): Promise<TgSendCodeResult> {
  // Свежий клиент: предыдущая попытка могла оставить устаревший phoneCodeHash.
  await h.clearPending();
  const client = await h.getPending();
  const result = await client.invoke(
    new Api.auth.SendCode({
      phoneNumber,
      apiId,
      apiHash,
      settings: new Api.CodeSettings({}),
    }),
  );
  if (!(result instanceof Api.auth.SentCode)) {
    throw new Error("unexpected sendCode response");
  }
  return {
    phoneCodeHash: result.phoneCodeHash,
    isCodeViaApp: result.type instanceof Api.auth.SentCodeTypeApp,
  };
}

export type TgSignInResult =
  | { kind: "ok"; client: TelegramClient }
  | { kind: "user_not_found" }
  | { kind: "password_needed" }
  | { kind: "phone_code_invalid" };

export async function tgSignIn(
  h: TgPendingHelpers,
  args: { phoneNumber: string; phoneCode: string; phoneCodeHash: string },
): Promise<TgSignInResult> {
  const client = await h.getPending();
  try {
    const result = await client.invoke(new Api.auth.SignIn(args));
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      return { kind: "user_not_found" };
    }
    return { kind: "ok", client };
  } catch (e) {
    const msg = errMsg(e);
    if (msg.includes("SESSION_PASSWORD_NEEDED")) return { kind: "password_needed" };
    if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EXPIRED")) {
      return { kind: "phone_code_invalid" };
    }
    throw e;
  }
}

export type TgSignInPasswordResult =
  | { kind: "ok"; client: TelegramClient }
  | { kind: "password_invalid" };

export async function tgSignInPassword(
  h: TgPendingHelpers,
  password: string,
): Promise<TgSignInPasswordResult> {
  const client = await h.getPending();
  try {
    // 2FA через SRP: тащим параметры с TG, считаем proof, отправляем check.
    const passwordParams = await client.invoke(new Api.account.GetPassword());
    const check = await computeCheck(passwordParams, password);
    const result = await client.invoke(
      new Api.auth.CheckPassword({ password: check }),
    );
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new Error("user not found");
    }
    return { kind: "ok", client };
  } catch (e) {
    if (errMsg(e).includes("PASSWORD_HASH_INVALID")) {
      return { kind: "password_invalid" };
    }
    throw e;
  }
}

export type TgQrState<T> =
  | { status: "scan-qr-code"; token: string }
  | { status: "password_needed" }
  | { status: "success"; data: T };

// readState для QR-stream: смотрит текущий login-token, и если TG вернул success
// (юзер подтвердил скан) — вызывает onSuccess где сохраняется session/profile.
// Возвращает state, который будет отдан фронту через SSE.
export async function tgReadQrState<T>(
  h: TgPendingHelpers,
  apiId: number,
  apiHash: string,
  onSuccess: (client: TelegramClient) => Promise<T>,
): Promise<TgQrState<T>> {
  const client = await h.getPending();
  try {
    const result = await exportLoginTokenCached(
      h.cacheKey,
      client,
      apiId,
      apiHash,
    );
    if (result instanceof Api.auth.LoginTokenSuccess) {
      const data = await onSuccess(client);
      return { status: "success", data };
    }
    const tokenB64 = Buffer.from(result.token).toString("base64url");
    return { status: "scan-qr-code", token: tokenB64 };
  } catch (e) {
    if (errMsg(e).includes("SESSION_PASSWORD_NEEDED")) {
      return { status: "password_needed" };
    }
    throw e;
  }
}

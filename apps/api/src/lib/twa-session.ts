import { StringSession } from "telegram/sessions";
import { tryDecrypt } from "./crypto";

// Конвертит наш зашифрованный gramjs StringSession в формат TWA ApiSessionData
// (см. apps/tg-client/src/api/types/misc.ts → ApiSessionData).
//
// gramjs StringSession.load() парсит base64 в dcId/serverAddress/port + authKey.
// TWA ждёт keys как `{[dcId]: hexString}` где hexString — authKey bytes hex.
//
// Возвращает null если session не расшифровался (corrupted ciphertext).
export async function toTwaSession(encryptedSession: string): Promise<{
  mainDcId: number;
  keys: Record<number, string>;
  isTest?: true;
} | null> {
  const decoded = tryDecrypt(encryptedSession);
  if (!decoded) return null;

  const session = new StringSession(decoded);
  await session.load();

  const authKey = session.authKey;
  if (!authKey) return null;
  const keyBuf = (authKey as unknown as { _key?: Buffer })._key;
  if (!keyBuf) return null;

  return {
    mainDcId: session.dcId,
    keys: {
      [session.dcId]: keyBuf.toString("hex"),
    },
  };
}

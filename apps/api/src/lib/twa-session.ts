import { StringSession } from "telegram/sessions";
import { tryDecrypt } from "./crypto";

// Конвертит наш зашифрованный gramjs StringSession в формат который ожидает
// Telegram Web A (см. apps/tg-client/src/api/types/misc.ts → ApiSessionData).
//
// gramjs StringSession.load() парсит base64 в поля dcId/serverAddress/port +
// authKey (Buffer). TWA ждёт keys как `{[dcId]: hexString}` где hexString —
// authKey байты в hex.
//
// Возвращает null если session не расшифровался (corrupted/legacy plain).
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

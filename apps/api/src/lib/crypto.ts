import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

// Симметричное шифрование MTProto session-string'ов и других секретов перед
// записью в БД. AES-256-GCM = authenticated encryption (отлавливает повреждения /
// подмену). Ключ выводим из ENCRYPTION_SECRET через SHA-256 — секрет любой длины.
//
// Format ciphertext: `iv.tag.payload` все base64url. Per-row IV (12 байт) делает
// одинаковые plaintext'ы шифрованными по-разному.
//
// ВНИМАНИЕ: потеря ENCRYPTION_SECRET = unrecoverable. В prod — secrets manager.

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ENCRYPTION_SECRET не задан или короче 16 символов — задайте в .env",
    );
  }
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

export function decrypt(s: string): string {
  const [ivB64, tagB64, encB64] = s.split(".");
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error("invalid ciphertext format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// Удобно для миграции legacy plaintext → encrypted (или для случаев когда
// row может быть из старой версии без encryption). Возвращает null при любой
// ошибке: missing secret, неверный формат, MAC fail, etc.
export function tryDecrypt(s: string): string | null {
  try {
    return decrypt(s);
  } catch {
    return null;
  }
}

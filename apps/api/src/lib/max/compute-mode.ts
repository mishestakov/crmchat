// Автономное вычисление поля `mode` для AUTH_REQUEST мессенджера MAX — без устройства.
//
// Сервер режет запрос кода от клиента с deviceType=ANDROID, если тот не предъявил `mode` —
// нативную integrity-подпись, которую приложение считает в libmax.so
// (CallsSdkInitializer.initializeSessionSeed). Формула восстановлена реверсом (Ghidra + jadx)
// и подтверждена 17/17 против нативного оракула на рутованном устройстве:
//
//   mode (96 байт) = SHA256(X0 ‖ seedBE ‖ deviceId)
//                  ‖ SHA256(X1 ‖ seedBE ‖ deviceId)
//                  ‖ SHA256(X2 ‖ seedBE ‖ deviceId)
//   X0 = SHA256(cert)                                       — сертификат подписи APK
//   X1 = SHA256(первые 20 байт каждого *.dex в base.apk)    — integrity dex (calculateMeta)
//   X2 = SHA256(содержимого lib/arm64-v8a/*.so, base+splits)— integrity нативных либ
//   seedBE   = 8 байт big-endian от callsSeed (из ответа SESSION_INIT)
//   deviceId = UTF-8 байты deviceId, что клиент шлёт в SESSION_INIT/AUTH_REQUEST
//
// X0/X1/X2 — константы конкретной сборки, вычисляются из APK этой версии
// (apps/api/src/lib/max/tools/derive-mode-consts.py, устройство НЕ нужно). userAgent клиента ОБЯЗАН
// заявлять ту же версию (см. MAX_USER_AGENT в auth.ts) — иначе integrity не сойдётся.
// Обе версии ниже подтверждены живой SMS-пробой. Как добавить новую — README-mode.md.

import crypto from "node:crypto";

// Ключ MODE_CONSTS — buildNumber (строкой). appVersion — только для читаемости/логов.
interface ModeConsts {
  appVersion: string;
  X0: Buffer;
  X1: Buffer;
  X2: Buffer;
}

const hx = (h: string) => Buffer.from(h, "hex");

export const MODE_CONSTS: Record<string, ModeConsts> = {
  // 26.26.0 — текущая рабочая версия. X посчитаны из APK (build 6797), проверены живой SMS.
  "6797": {
    appVersion: "26.26.0",
    X0: hx("1684414033eb263e2c615f8b7df5ed8793850a07656304997fbf07e9e21e1e93"),
    X1: hx("2538a819fdcf2cf8afdcb1ab1476d0c08cc0e4d4bad86f1bf381408d081ec410"),
    X2: hx("634ecc42b246784d975f180b4fecf903df235cdf0476da47163a85630eb1a6a8"),
  },
  // 26.25.0 — предыдущая (снималась оракулом, эталон для восстановления формулы).
  "6790": {
    appVersion: "26.25.0",
    X0: hx("1684414033eb263e2c615f8b7df5ed8793850a07656304997fbf07e9e21e1e93"),
    X1: hx("8db68fcc0e85e8f041fe4a875c0a9bcfe542a8f679603728c651ed81b64dd684"),
    X2: hx("634ecc42b246784d975f180b4fecf903df235cdf0476da47163a85630eb1a6a8"),
  },
};

// Билд по умолчанию — должен совпадать с MAX_USER_AGENT.buildNumber в auth.ts.
export const DEFAULT_MODE_BUILD = 6797;

// callsSeed приходит из SESSION_INIT знаковым 64-битным — 8 байт big-endian (two's complement).
function seedToBytes(callsSeed: string | bigint | number): Buffer {
  let v = BigInt(callsSeed) & ((1n << 64n) - 1n);
  const b = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return b;
}

const sha256 = (buf: Buffer): Buffer => crypto.createHash("sha256").update(buf).digest();

export function computeMode(
  callsSeed: string | bigint | number,
  deviceId: string,
  buildNumber: number | string = DEFAULT_MODE_BUILD,
): Buffer {
  const c = MODE_CONSTS[String(buildNumber)];
  if (!c) throw new Error(`нет mode-констант для buildNumber ${buildNumber} — пересчитай из APK`);
  const seed = seedToBytes(callsSeed);
  const dev = Buffer.from(deviceId, "utf8");
  return Buffer.concat([
    sha256(Buffer.concat([c.X0, seed, dev])),
    sha256(Buffer.concat([c.X1, seed, dev])),
    sha256(Buffer.concat([c.X2, seed, dev])),
  ]);
}

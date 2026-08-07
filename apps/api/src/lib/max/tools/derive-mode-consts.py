#!/usr/bin/env python3
"""
Пересчёт mode-констант X0/X1/X2 для новой версии приложения MAX — БЕЗ устройства.
Нужны только APK-файлы нужной версии (base + split_config.arm64_v8a [+ xxhdpi]).
Рутовый телефон НЕ требуется: всё считается из файлов.

Использование:
    python3 derive-mode-consts.py <base.apk> <split_arm64.apk> [<split_xxhdpi.apk> ...]

Печатает готовый блок для MODE_CONSTS в apps/api/src/lib/max/compute-mode.ts.
Подробности — apps/api/src/lib/max/README-mode.md.
"""
import sys, zipfile, hashlib

ABI = "arm64-v8a"
sha256 = lambda b: hashlib.sha256(b).digest()

def cert_der(base_apk):
    # DER сертификата подписи APK (X.509). Схема v2/v3 — читаем через androguard,
    # с фолбэком на apksigner-парсинг блока подписи не заморачиваемся: androguard стабилен.
    from androguard.core.apk import APK
    a = APK(base_apk)
    certs = a.get_certificates_der_v2() or a.get_certificates_der_v3() or []
    if not certs:
        raise SystemExit("не нашёл сертификат подписи в " + base_apk)
    return certs[0]

def calc_meta(apks, ext, size_limit, filter_arch):
    md = hashlib.sha256()
    def do(apk):
        zf = zipfile.ZipFile(apk)
        ents = zf.infolist()
        if filter_arch:
            ents = [e for e in ents if e.filename.startswith("lib/%s/" % ABI)]
        ents = [e for e in ents if e.filename.endswith(ext)]
        for e in ents:
            sz = e.file_size if size_limit < 0 else min(size_limit, e.file_size)
            md.update(zf.read(e.filename)[:sz])
        zf.close()
    do(apks[0])                       # base всегда
    if filter_arch:
        for ap in apks[1:]:           # splits — только при filterByArch
            do(ap)
    return md.digest()

def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    apks = sys.argv[1:]
    X0 = sha256(cert_der(apks[0]))                    # SHA256(cert)
    X1 = calc_meta(apks, ".dex", 20, False)           # первые 20 байт каждого *.dex в base
    X2 = calc_meta(apks, ".so", -1, True)             # *.so из lib/arm64-v8a, base+splits
    print("// сгенерировано scripts/max/derive-mode-consts.py — подставь buildNumber/appVersion")
    print('"<BUILD_NUMBER>": {')
    print('  appVersion: "<APP_VERSION>",')
    print("  buildNumber: <BUILD_NUMBER>,")
    print(f'  X0: hx("{X0.hex()}"),')
    print(f'  X1: hx("{X1.hex()}"),')
    print(f'  X2: hx("{X2.hex()}"),')
    print("},")

if __name__ == "__main__":
    main()

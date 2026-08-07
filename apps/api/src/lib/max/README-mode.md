# MAX auth: поле `mode` и обновление версии приложения

## Зачем это

Сервер MAX режет запрос кода (`AUTH_REQUEST`) от клиента с `deviceType: ANDROID`, если тот
не предъявил поле **`mode`** — нативную integrity-подпись, которую приложение считает в
`libmax.so` (`CallsSdkInitializer.initializeSessionSeed`). Без `mode` сервер отвечает
формально успешно (`token`, `requestCountLeft`), но **SMS молча не отправляет**.

Мы восстановили формулу `mode` и считаем её сами в Node — **устройство не нужно**
(`compute-mode.ts`).

## Формула

```
mode (96 байт) = SHA256(X0 ‖ seedBE ‖ deviceId)
               ‖ SHA256(X1 ‖ seedBE ‖ deviceId)
               ‖ SHA256(X2 ‖ seedBE ‖ deviceId)

X0 = SHA256(cert)                                     — сертификат подписи APK
X1 = SHA256(первые 20 байт каждого *.dex в base.apk)  — integrity dex
X2 = SHA256(содержимого lib/arm64-v8a/*.so, base+splits, целиком) — integrity нативных либ
seedBE   = 8 байт big-endian от callsSeed (из ответа SESSION_INIT, знаковое int64)
deviceId = UTF-8 байты deviceId, который клиент шлёт в SESSION_INIT/AUTH_REQUEST
```

`X0/X1/X2` — три 32-байтовые **константы конкретной сборки APK**. Средний блок (`X1`) — это
метод `CallsSdkInitializer.calculateMeta`, который хеширует файлы самого APK (антитампер).

## ⚠️ Главное правило

`MAX_USER_AGENT.buildNumber` (auth.ts), `DEFAULT_MODE_BUILD` (compute-mode.ts) и версия, из
которой посчитаны `X`, **обязаны совпадать**. Сервер сверяет integrity с той версией, что
клиент заявил в `userAgent`. Рассинхрон → SMS снова перестанут приходить.

## Что делать, когда приложение обновилось («с этой версией больше не работает»)

Рутовый телефон **НЕ нужен**. Нужны только APK новой версии. Порядок:

1. **Достать APK новой версии** — `base.apk` + `split_config.arm64_v8a.apk`
   (`split_config.xxhdpi.apk` желателен, но `.so` в основном в arm64-сплите). Источник любой:
   - `adb shell pm path ru.oneme.app` → `adb pull …` с ЛЮБОГО телефона (обычная отладка, без рута);
   - RuStore / зеркало APK. Подпись должна быть родная MAX (проверь: `apksigner verify
     --print-certs base.apk` → SHA-256 `1684414033eb…`). Если подпись чужая (перепак) — `mode`
     будет неверный.
   - Узнать `buildNumber`/`versionName`: `aapt dump badging base.apk | head -1`.

2. **Посчитать константы** (нужен python + androguard; `zipfile`/`hashlib` встроены):
   ```bash
   python3 apps/api/src/lib/max/tools/derive-mode-consts.py base.apk split_config.arm64_v8a.apk split_config.xxhdpi.apk
   ```
   Скрипт печатает готовый блок `"<BUILD>": { X0, X1, X2 }`.

3. **Прописать** в `compute-mode.ts`: добавить блок в `MODE_CONSTS`, подставить `appVersion`/
   `buildNumber`, поднять `DEFAULT_MODE_BUILD`. В `auth.ts` обновить `MAX_USER_AGENT`
   (`appVersion` + `buildNumber`, а также `osVersion`/`deviceName`/`screen`, если хочется
   ближе к реальному устройству).

4. **Проверить живой пробой** — один запрос кода на тестовый номер: SMS пришла → готово.

## Когда рут ВСЁ-ТАКИ понадобится

Только если MAX поменяет **сам алгоритм** `mode` (не значения, а структуру: другой набор
файлов, другой порядок, не SHA-256). Тогда пересчёт `X` не спасёт — нужно заново снять
эталон нативным оракулом на рутованном телефоне и подогнать формулу. Инструменты для этого
лежат в `~/max-so-work` (frida-оракул `oracle-driver.py`/`oracle-batch.py`, анализаторы
`finish-formula.py`/`verify-formula.py`). Признак что дело в алгоритме, а не в значениях:
свежепосчитанные `X` из корректно подписанного APK не дают SMS.

## Как это восстанавливали (для контекста)

libmax.so → Ghidra (форма: 3×SHA-256, cert как SHA256(cert)) → строки среднего блока
указали на `CallsSdkInitializer.calculateMeta` → jadx декомпиляция метода (это Java в dex, не
нативка) → подбор параметров `ext`/`size`/`arch` против эталонных пар с оракула → 17/17
совпадений, подтверждено сквозной SMS-пробой на 26.25.0 и 26.26.0.

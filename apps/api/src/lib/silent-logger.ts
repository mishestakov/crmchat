import type { TelegramClient } from "telegram";

// gramjs по дефолту шумит INFO в stdout. Заглушка для prod-quietness.
// Для дебага можно подменить на `new Logger("info")`.
export function silentLogger() {
  return {
    canSend: () => false,
    setLevel: () => {},
    log: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    format: () => "",
    getDateTime: () => "",
    levels: ["error", "warn", "info", "debug"],
    messageFormat: "",
    tzOffset: 0,
    colors: {},
    isBrowser: false,
  } as unknown as ConstructorParameters<typeof TelegramClient>[3]["baseLogger"];
}

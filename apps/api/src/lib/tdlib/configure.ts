import * as tdl from "tdl";

// Однократная конфигурация tdl: путь к libtdjson.so и креды my.telegram.org.
// Импортируется первым кем угодно из tdlib/* — сайд-эффектом настраивает
// глобальный addon. Флаг живёт на globalThis, потому что bun --hot пересоздаёт
// module scope при HMR, а native addon (libtdjson) — нет: повторный
// tdl.configure() ругается «tdjson is already loaded».

const FLAG = "__crmchat_tdl_configured__";

declare global {
  // eslint-disable-next-line no-var
  var __crmchat_tdl_configured__: boolean | undefined;
}

export function ensureTdlConfigured(): void {
  if ((globalThis as Record<string, unknown>)[FLAG]) return;

  const libdir = process.env.TDLIB_LIBDIR;
  if (!libdir) {
    throw new Error(
      "TDLIB_LIBDIR не задан. Соберите libtdjson.so через tools/tdlib/build.sh и подключите: eval \"$(tools/tdlib/build.sh --env)\".",
    );
  }

  try {
    tdl.configure({
      tdjson: "libtdjson.so",
      libdir,
      // 1 = ошибки + warnings (default — чуть тише, чем gramjs INFO).
      verbosityLevel: 1,
    });
  } catch (e) {
    // bun --hot и pkill перезапуски: native addon (libtdjson) уже загружен
    // в адресное пространство процесса, повторный configure ругается
    // «tdjson is already loaded». Если так — просто помечаем флаг и идём
    // дальше, addon уже настроен.
    if (
      e instanceof Error &&
      /already loaded|already configured/i.test(e.message)
    ) {
      // ok, идём дальше
    } else {
      throw e;
    }
  }
  (globalThis as Record<string, unknown>)[FLAG] = true;
}

export const tgApiId = Number(process.env.TELEGRAM_API_ID ?? 0);
export const tgApiHash = process.env.TELEGRAM_API_HASH ?? "";

if (!tgApiId || !tgApiHash) {
  console.warn(
    "[tdlib] TELEGRAM_API_ID / TELEGRAM_API_HASH не заданы — TG-фичи не работают",
  );
}

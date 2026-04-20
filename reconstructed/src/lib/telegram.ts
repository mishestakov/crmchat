import { TelegramPlatform } from "@repo/core/types";

const isWebApp =
  !!window.Telegram?.WebApp?.initData &&
  window.Telegram?.WebApp?.platform !== "unknown";

export const webApp = isWebApp ? window.Telegram?.WebApp : undefined;
export const webAppRaw = window.Telegram?.WebApp;

export const isDesktopWebApp =
  webApp &&
  ["macos", "tdesktop", "unigram", "unknown"].includes(webApp.platform);

export const isWideScreenWebApp =
  isDesktopWebApp || navigator.platform === "iPad";

export function getPlatform(): TelegramPlatform {
  const { userAgent, platform } = window.navigator;

  const iosPlatforms = ["iPhone", "iPad", "iPod"];
  if (
    iosPlatforms.includes(platform) ||
    (platform === "MacIntel" &&
      "maxTouchPoints" in navigator &&
      navigator.maxTouchPoints > 2)
  )
    return "iOS";

  const macosPlatforms = ["Macintosh", "MacIntel", "MacPPC", "Mac68K"];
  if (macosPlatforms.includes(platform)) return "macOS";

  const windowsPlatforms = ["Win32", "Win64", "Windows", "WinCE"];
  if (windowsPlatforms.includes(platform)) return "Windows";

  if (/Android/.test(userAgent)) return "Android";

  if (/Linux/.test(platform)) return "Linux";

  return "Unknown platform";
}

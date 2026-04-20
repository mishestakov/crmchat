import { useEffect } from "react";

import { useTheme } from "./useTheme";
import { hexToHsl, hslToHex } from "@/lib/colors";
import { webApp } from "@/lib/telegram";

export function useTelegramTheme() {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!webApp) return;

    setTheme(webApp.colorScheme);
    const onThemeChanged = function (this: { colorScheme: "light" | "dark" }) {
      setTheme(this.colorScheme);
      console.info(`Set theme to ${this.colorScheme}`);
    };

    setTimeout(() => {
      try {
        const bgColor = window
          .getComputedStyle(document.documentElement)
          .getPropertyValue("--background");

        const rgbHex = hslToHex(bgColor);
        webApp!.setBackgroundColor(rgbHex);
        webApp!.setHeaderColor(rgbHex);
        webApp!.setBottomBarColor(rgbHex);

        console.log(`Set mini-app background color to ${rgbHex}`);
      } catch (e) {
        console.error("Failed to set background color", e);
      }

      try {
        const tgPrimaryHex = window
          .getComputedStyle(document.documentElement)
          .getPropertyValue("--tg-theme-button-color");
        const tgPrimaryHsl = hexToHsl(tgPrimaryHex);

        document.body.style.setProperty("--ring", tgPrimaryHsl);
        document.body.style.setProperty("--primary", tgPrimaryHsl);

        const tgPrimaryForegroundHex = window
          .getComputedStyle(document.documentElement)
          .getPropertyValue("--tg-theme-button-text-color");
        const tgPrimaryForegroundHsl = hexToHsl(tgPrimaryForegroundHex);

        document.body.style.setProperty(
          "--primary-foreground",
          tgPrimaryForegroundHsl
        );
        console.info(`Set app primary color to hsl(${tgPrimaryHsl})`);
      } catch (e) {
        console.error("Failed to update app primary color", e);
      }
    });

    webApp.ready();

    webApp.onEvent("themeChanged", onThemeChanged);
    return () => {
      webApp!.offEvent("themeChanged", onThemeChanged);
    };
  }, [setTheme]);
}

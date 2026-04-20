import i18n from "i18next";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

import locales from "@repo/core/locales";

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en", "ru"],

    ns: ["common"],
    defaultNS: "common",

    resources: locales,

    interpolation: {
      escapeValue: false,
    },

    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
  });

// eslint-disable-next-line unicorn/prefer-export-from
export default i18n;

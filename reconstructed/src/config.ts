type Config = {
  apiUrl: string;
  dcDomain: string;
};
let _cachedConfig: Config | undefined;

async function _getConfig(): Promise<Config> {
  if (!_cachedConfig) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(
        `${import.meta.env.DEV ? "/config.local.json" : "/config.json"}`,
        {
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);

      const data = await response.json();
      _cachedConfig = data;
    } catch (error) {
      console.warn("Failed to fetch config.json, using fallback:", error);
      _cachedConfig = {
        apiUrl: import.meta.env.VITE_BACKEND_URL,
        dcDomain: "dc",
      };
    }
  }

  return _cachedConfig!;
}

export async function getApiUrl(path?: string) {
  path = path?.startsWith("/") ? path.slice(1) : path;
  return (await _getConfig()).apiUrl + (path ? `/${path}` : "");
}

export function getCachedApiUrlOrFallback(path?: string) {
  path = path?.startsWith("/") ? path.slice(1) : path;
  return (
    (_cachedConfig?.apiUrl ?? import.meta.env.VITE_BACKEND_URL) +
    (path ? `/${path}` : "")
  );
}

export async function getDcDomain() {
  return (await _getConfig()).dcDomain;
}

export function getCachedDcDomain() {
  return _cachedConfig?.dcDomain ?? "dc";
}

export const ZAPIER_INVITE_URL =
  "https://zapier.com/developer/public-invite/209662/ffc2342b0deaa77b835b97c36d0e0069/";

export const TELEGRAM_ACCOUNT_PRICE_USD = 25;
export const AI_BOT_PRICE_USD = 300;

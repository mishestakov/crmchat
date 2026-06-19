// Единое правило «состояния отправителя» для всех мест, где outreach-аккаунт
// виден или выбирается (драйвер чата, выбор аккаунтов проекта, запуск кампании).
// banned/unauthorized — мёртвый аккаунт (красный), cooldown — временная отлёжка
// (amber). Кулдаун НЕ блокирует ручную отправку: TG ограничивает только письма
// новым контактам, в существующей переписке шлёт — поэтому это информация, не
// гейт (см. quick-send.ts). Поля приходят из ручки outreach/accounts.
export type AccountHealthInput = {
  status?: string | null;
  cooldownUntil?: string | null;
  cooldownReason?: string | null;
};

export type AccountHealth = {
  kind: "ok" | "cooldown" | "banned";
  // Подробность для баннера/тултипа (причина PEER_FLOOD/FloodWait и т.п.).
  detail: string | null;
};

export function accountHealth(a: AccountHealthInput | undefined): AccountHealth {
  if (!a) return { kind: "ok", detail: null };
  if (a.status === "banned")
    return { kind: "banned", detail: "Аккаунт забанен Telegram" };
  if (a.status === "unauthorized")
    return { kind: "banned", detail: "Аккаунт разлогинен — нужна переавторизация" };
  if (a.cooldownUntil && new Date(a.cooldownUntil).getTime() > Date.now())
    return {
      kind: "cooldown",
      detail: a.cooldownReason ?? "Аккаунт во временном кулдауне Telegram",
    };
  return { kind: "ok", detail: null };
}

// Цвет точки-индикатора по состоянию — единый для всех мест.
export function accountHealthDotClass(kind: AccountHealth["kind"]): string {
  if (kind === "banned") return "bg-red-500";
  if (kind === "cooldown") return "bg-amber-500";
  return "bg-emerald-500";
}

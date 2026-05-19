import { randomBytes } from "node:crypto";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { issueBridgeToken } from "./bridge-tokens.ts";

// Telegram Bot deep-link login flow — обход RKN-блокировки oauth.telegram.org.
// SPA → start: получаем authToken + t.me deep-link → юзер открывает в TG → бот
// шлёт inline-кнопку «Подтвердить» → callback_query помечает entry approved +
// создаёт bridge-token → SPA poll'ит и редиректит на /auth/finish?bt=...
// Pending-tokens живут в памяти 5 минут, рестарт api сбрасывает их.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "").replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

const TTL_MS = 5 * 60 * 1000;

type AuthEntry = {
  status: "pending" | "approved" | "rejected";
  bridgeToken?: string;
  createdAt: number;
};
const authStore = new Map<string, AuthEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of authStore) {
    if (now - entry.createdAt > TTL_MS) authStore.delete(token);
  }
}, 60_000).unref();

export function issueAuthToken(): {
  token: string;
  deepLink: string;
  webLink: string;
} {
  const token = randomBytes(24).toString("base64url");
  authStore.set(token, { status: "pending", createdAt: Date.now() });
  return {
    token,
    // tg://-scheme отдаётся ОС прямо в TG-приложение, минуя t.me-страницу
    // (которая может быть RKN-чувствительна на некоторых провайдерах).
    deepLink: `tg://resolve?domain=${BOT_USERNAME}&start=${token}`,
    // Fallback на t.me для тех, у кого TG не установлен или браузер не
    // поддержал tg:// scheme.
    webLink: `https://t.me/${BOT_USERNAME}?start=${token}`,
  };
}

export type AuthCheckResult =
  | { status: "pending" }
  | { status: "approved"; bridgeToken: string }
  | { status: "rejected" }
  | { status: "expired" };

export function checkAuthToken(token: string): AuthCheckResult {
  const entry = authStore.get(token);
  if (!entry) return { status: "expired" };
  if (Date.now() - entry.createdAt > TTL_MS) {
    authStore.delete(token);
    return { status: "expired" };
  }
  if (entry.status === "approved") {
    // approve — одноразовый consume: bridge-token сам имеет TTL 60s, дальше его
    // съест /v1/auth/finish.
    authStore.delete(token);
    return { status: "approved", bridgeToken: entry.bridgeToken! };
  }
  if (entry.status === "rejected") {
    authStore.delete(token);
    return { status: "rejected" };
  }
  return { status: "pending" };
}

type TgUser = {
  id: number;
  username?: string;
  first_name: string;
  last_name?: string;
};
type TgMessage = {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
};
type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

async function tgApi<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    // Без таймаута hung-запрос в TG зависит webhook-хендлер навсегда,
    // и TG ретрайит → дубликаты updates. Idempotency проверкой по
    // status защищаемся, но дешевле сразу отрезать по таймауту.
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as {
    ok: boolean;
    result: T;
    description?: string;
  };
  if (!json.ok) throw new Error(`tg ${method}: ${json.description}`);
  return json.result;
}

export function isBotConfigured(): boolean {
  return !!BOT_TOKEN && !!BOT_USERNAME && !!WEBHOOK_SECRET && !!WEB_ORIGIN;
}

export function getWebhookSecret(): string {
  return WEBHOOK_SECRET;
}

// Идемпотентно: повторный setWebhook просто перестанавливает URL/secret.
export async function setupWebhook(): Promise<void> {
  if (!isBotConfigured()) {
    console.warn(
      "[tg-bot] TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME / TELEGRAM_WEBHOOK_SECRET / WEB_ORIGIN не заданы — webhook не регистрируется",
    );
    return;
  }
  const url = `${WEB_ORIGIN}/v1/webhooks/tg-bot`;
  await tgApi("setWebhook", {
    url,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  console.log(`[tg-bot] webhook registered: ${url}`);
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.message?.text?.startsWith("/start")) {
    await onStart(update.message);
    return;
  }
  if (update.callback_query?.data) {
    await onCallback(update.callback_query);
  }
}

async function onStart(message: TgMessage): Promise<void> {
  const parts = message.text!.split(/\s+/, 2);
  const authToken = parts[1] ?? "";
  const entry = authToken ? authStore.get(authToken) : undefined;
  if (!entry || entry.status !== "pending") {
    await tgApi("sendMessage", {
      chat_id: message.chat.id,
      text: "Эта ссылка для входа недействительна или истекла. Запросите новую на странице логина.",
    });
    return;
  }
  const from = message.from;
  const displayName = from
    ? [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "?"
    : "?";
  await tgApi("sendMessage", {
    chat_id: message.chat.id,
    text: `Подтвердить вход в CRM как «${displayName}»?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "✅ Подтвердить", callback_data: `approve:${authToken}` },
          { text: "❌ Отмена", callback_data: `reject:${authToken}` },
        ],
      ],
    },
  });
}

async function onCallback(cb: TgCallbackQuery): Promise<void> {
  const sep = cb.data!.indexOf(":");
  const action = sep > 0 ? cb.data!.slice(0, sep) : cb.data!;
  const authToken = sep > 0 ? cb.data!.slice(sep + 1) : "";
  const entry = authStore.get(authToken);

  if (!entry || entry.status !== "pending") {
    await tgApi("answerCallbackQuery", {
      callback_query_id: cb.id,
      text: "Ссылка истекла или уже использована. Запросите новую.",
      show_alert: true,
    });
    return;
  }

  if (action === "reject") {
    authStore.set(authToken, { ...entry, status: "rejected" });
    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "Отменено" });
    if (cb.message) {
      await tgApi("editMessageText", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "Вход отменён.",
      });
    }
    return;
  }

  if (action === "approve") {
    const tgUser = cb.from;
    const fullName =
      [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || "?";
    const [row] = await db
      .insert(users)
      .values({
        tgUserId: String(tgUser.id),
        name: fullName,
        username: tgUser.username ?? null,
      })
      .onConflictDoUpdate({
        target: users.tgUserId,
        set: {
          name: fullName,
          username: tgUser.username ?? null,
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id });

    const bt = issueBridgeToken(row!.id);
    authStore.set(authToken, { ...entry, status: "approved", bridgeToken: bt });

    await tgApi("answerCallbackQuery", { callback_query_id: cb.id, text: "Готово" });
    if (cb.message) {
      await tgApi("editMessageText", {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        text: "Вход подтверждён ✅ Вернитесь в браузер.",
      });
    }
  }
}

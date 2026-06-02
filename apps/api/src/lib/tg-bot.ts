import { randomBytes } from "node:crypto";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { issueBridgeToken } from "./bridge-tokens.ts";
import {
  attachAuthStateBus,
  createTdClient,
  extractActiveUsername,
  type TdClient,
  type TdUser,
  waitForAuthState,
} from "./tdlib/index.ts";

// Telegram bot login через TDLib (MTProto), а не Bot API/webhook. На RU-сервере
// Bot API ненадёжен (webhook не доставляется входящим к RU-IP, исходящий
// RKN-троттлится), а TDLib идёт через тот же MTProto-прокси, что и outreach-
// аккаунты. Бот логинится по bot-token (checkAuthenticationBotToken), апдейты
// (updateNewMessage / updateNewCallbackQuery) приходят по MTProto.
//
// Флоу: SPA → start: authToken + tg deep-link → юзер открывает в TG → бот ловит
// /start <token> → шлёт inline «Подтвердить» → callback помечает entry approved
// + создаёт bridge-token → SPA poll'ит checkAuthToken и редиректит на finish.
// Pending-tokens живут в памяти 5 минут, рестарт api их сбрасывает.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME ?? "";
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "").replace(/\/$/, "");

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
    // tg://-scheme отдаётся ОС прямо в TG-приложение, минуя t.me-страницу.
    deepLink: `tg://resolve?domain=${BOT_USERNAME}&start=${token}`,
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
    authStore.delete(token);
    return { status: "approved", bridgeToken: entry.bridgeToken! };
  }
  if (entry.status === "rejected") {
    authStore.delete(token);
    return { status: "rejected" };
  }
  return { status: "pending" };
}

export function isBotConfigured(): boolean {
  return !!BOT_TOKEN && !!BOT_USERNAME && !!WEB_ORIGIN;
}

// --- TDLib I/O (сверено с td_api.tl) ---------------------------------------
// Поля без провайдер-аналога (topic_id / reply_to / options и т.п.) опускаем —
// td_json подставляет дефолты.

// inputMessageText (td_api.tl:5477) — только text; link_preview_options/
// clear_draft опускаем (TDLib подставит дефолты).
function inputText(text: string): unknown {
  return {
    _: "inputMessageText",
    text: { _: "formattedText", text, entities: [] },
  };
}

async function sendText(
  client: TdClient,
  chatId: number,
  text: string,
  replyMarkup?: unknown,
): Promise<void> {
  await client.invoke({
    _: "sendMessage",
    chat_id: chatId,
    input_message_content: inputText(text),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  } as never);
}

async function editText(
  client: TdClient,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await client.invoke({
    _: "editMessageText",
    chat_id: chatId,
    message_id: messageId,
    input_message_content: inputText(text),
  } as never);
}

async function answerCallback(
  client: TdClient,
  callbackQueryId: string, // int64 → строка
  text: string,
  showAlert = false,
): Promise<void> {
  await client.invoke({
    _: "answerCallbackQuery",
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert,
  } as never);
}

// Inline-клавиатура подтверждения. callback-data у TDLib — bytes → base64.
function confirmKeyboard(authToken: string): unknown {
  const cb = (s: string) => ({
    _: "inlineKeyboardButtonTypeCallback",
    data: Buffer.from(s, "utf8").toString("base64"),
  });
  // inlineKeyboardButton (td_api.tl:3514) имеет ещё icon_custom_emoji_id/style —
  // это поздние ОПЦИОНАЛЬНЫЕ поля (кнопки существовали до них). Намеренно их не
  // задаём: TDLib подставит дефолты, а мы не привязываемся к конкретной версии
  // схемы (меньше шансов сломаться при апгрейде prebuilt-tdlib).
  const btn = (text: string, data: string) => ({
    _: "inlineKeyboardButton",
    text,
    type: cb(data),
  });
  return {
    _: "replyMarkupInlineKeyboard",
    rows: [
      [
        btn("✅ Подтвердить", `approve:${authToken}`),
        btn("❌ Отмена", `reject:${authToken}`),
      ],
    ],
  };
}

async function getUser(
  client: TdClient,
  userId: number,
): Promise<{ name: string; username: string | null }> {
  const u = (await client.invoke({
    _: "getUser",
    user_id: userId,
  } as never)) as TdUser;
  const username = extractActiveUsername(u);
  const name =
    [u.first_name, u.last_name].filter(Boolean).join(" ") || username || "?";
  return { name, username };
}

// --- Обработка апдейтов -----------------------------------------------------

async function onStart(
  client: TdClient,
  chatId: number,
  userId: number,
  text: string,
): Promise<void> {
  const authToken = text.split(/\s+/, 2)[1] ?? "";
  const entry = authToken ? authStore.get(authToken) : undefined;
  if (!entry || entry.status !== "pending") {
    await sendText(
      client,
      chatId,
      "Эта ссылка для входа недействительна или истекла. Запросите новую на странице логина.",
    );
    return;
  }
  const { name } = await getUser(client, userId);
  await sendText(
    client,
    chatId,
    `Подтвердить вход в CRM как «${name}»?`,
    confirmKeyboard(authToken),
  );
}

async function onCallback(
  client: TdClient,
  cb: {
    id: string;
    userId: number;
    chatId: number;
    messageId: number;
    data: string;
  },
): Promise<void> {
  const sep = cb.data.indexOf(":");
  const action = sep > 0 ? cb.data.slice(0, sep) : cb.data;
  const authToken = sep > 0 ? cb.data.slice(sep + 1) : "";
  const entry = authStore.get(authToken);

  if (!entry || entry.status !== "pending") {
    await answerCallback(
      client,
      cb.id,
      "Ссылка истекла или уже использована. Запросите новую.",
      true,
    );
    return;
  }

  if (action === "reject") {
    authStore.set(authToken, { ...entry, status: "rejected" });
    await answerCallback(client, cb.id, "Отменено");
    await editText(client, cb.chatId, cb.messageId, "Вход отменён.");
    return;
  }

  if (action === "approve") {
    const { name, username } = await getUser(client, cb.userId);
    const [row] = await db
      .insert(users)
      .values({ tgUserId: String(cb.userId), name, username })
      .onConflictDoUpdate({
        target: users.tgUserId,
        set: { name, username, updatedAt: new Date() },
      })
      .returning({ id: users.id });

    const bt = issueBridgeToken(row!.id);
    authStore.set(authToken, { ...entry, status: "approved", bridgeToken: bt });

    await answerCallback(client, cb.id, "Готово");
    await editText(
      client,
      cb.chatId,
      cb.messageId,
      "Вход подтверждён ✅ Вернитесь в браузер.",
    );
  }
}

type TdUpdate = { _: string; [k: string]: unknown };

async function onUpdate(client: TdClient, u: TdUpdate): Promise<void> {
  if (u._ === "updateNewMessage") {
    const m = u.message as {
      chat_id: number;
      is_outgoing: boolean;
      sender_id?: { _: string; user_id?: number };
      content?: { _: string; text?: { text?: string } };
    };
    if (m.is_outgoing) return; // свои сообщения не обрабатываем
    if (m.content?._ !== "messageText") return;
    const text = m.content.text?.text ?? "";
    if (!text.startsWith("/start")) return;
    // Отправитель: messageSenderUser.user_id (td_api.tl:2572). Личке боту это и
    // есть юзер; chat_id используем только чтобы ответить.
    const userId =
      m.sender_id?._ === "messageSenderUser" ? m.sender_id.user_id : undefined;
    if (userId == null) return;
    await onStart(client, m.chat_id, userId, text);
    return;
  }
  if (u._ === "updateNewCallbackQuery") {
    const payload = u.payload as { _: string; data?: string } | undefined;
    if (payload?._ !== "callbackQueryPayloadData" || !payload.data) return;
    await onCallback(client, {
      id: String(u.id),
      userId: u.sender_user_id as number,
      chatId: u.chat_id as number,
      messageId: u.message_id as number,
      // bytes → base64 → utf8 ("approve:<token>")
      data: Buffer.from(payload.data, "base64").toString("utf8"),
    });
  }
}

// --- Запуск -----------------------------------------------------------------

let botClient: TdClient | null = null;

// Поднимает TDLib-клиент бота: на свежей сессии логинится по bot-token, затем
// подписывается на апдейты. Сессия (auth-key, peer cache) живёт в
// .td-database/login-bot между рестартами → повторный старт уедет в ready сам.
export async function startBotClient(): Promise<void> {
  if (!isBotConfigured()) {
    console.warn(
      "[tg-bot] TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME / WEB_ORIGIN не заданы — бот не запускается",
    );
    return;
  }
  if (botClient) return;

  const client = createTdClient({
    key: { kind: "raw", key: "login-bot" },
    deviceModel: "CRM Login Bot",
  });
  botClient = client;
  const authBus = attachAuthStateBus(client);
  client.on("error", (e: unknown) =>
    console.error("[tg-bot] tdlib error:", e),
  );

  // Свежая сессия: на wait_phone_or_qr логинимся ботом по токену. Флаг — чтобы
  // не отправить токен дважды (subscribe + current при гонке инициализации;
  // второй checkAuthenticationBotToken TDLib отвергает).
  let tokenSent = false;
  const driveBotLogin = (s: { kind: string }): void => {
    if (s.kind === "wait_phone_or_qr" && !tokenSent) {
      tokenSent = true;
      void client
        .invoke({ _: "checkAuthenticationBotToken", token: BOT_TOKEN } as never)
        .catch((e: unknown) =>
          console.error("[tg-bot] checkAuthenticationBotToken failed:", e),
        );
    }
  };
  authBus.subscribe(driveBotLogin);
  driveBotLogin(authBus.current()); // если состояние проскочило до подписки

  try {
    await waitForAuthState(authBus, (s) => s.kind === "ready", 30_000);
  } catch (e) {
    // Прокси мёртв/медленный или токен невалиден → не залипаем: сбрасываем
    // botClient, чтобы повторный вызов startBotClient мог попробовать заново.
    botClient = null;
    throw e;
  }

  // skipOldUpdates (createTdClient) — backlog за время offline пропускается:
  // /start, посланный пока бот лежал, теряется (юзер повторит). Это плата за
  // MTProto vs server-side очередь getUpdates.
  client.on("update", (u: unknown) =>
    void onUpdate(client, u as TdUpdate).catch((e: unknown) =>
      console.error("[tg-bot] onUpdate failed:", e),
    ),
  );
  console.log("[tg-bot] TDLib bot client ready");
}

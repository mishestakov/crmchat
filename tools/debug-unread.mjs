#!/usr/bin/env node
// Отладка зеркала unread-счётчиков. Удаляется после фикса.
//
// Что делает:
// 1) Логинится в API через _dev/login.
// 2) Подписывается на /contact-stream (SSE), логирует каждый event с timestamp.
// 3) Водит юзера через сценарий — после каждого шага считает сколько событий
//    пришло за интервал, говорит "ОК / ПРОБЛЕМА".
//
// Запуск:
//   node tools/debug-unread.mjs

import readline from "node:readline/promises";

const API = process.env.API_URL || "http://localhost:3000";
const COLOR = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

const ts = () => new Date().toISOString().slice(11, 23);
const log = (msg) => console.log(`${COLOR.dim}[${ts()}]${COLOR.reset} ${msg}`);
const ok = (msg) => console.log(`${COLOR.green}✓ ${msg}${COLOR.reset}`);
const err = (msg) => console.log(`${COLOR.red}✗ ${msg}${COLOR.reset}`);
const warn = (msg) => console.log(`${COLOR.yellow}! ${msg}${COLOR.reset}`);
const info = (msg) => console.log(`${COLOR.cyan}→ ${msg}${COLOR.reset}`);

let events = [];
const recordEvent = (payload) => {
  events.push({ at: Date.now(), payload });
  log(`${COLOR.cyan}SSE event:${COLOR.reset} ${JSON.stringify(payload)}`);
};
const eventsSince = (sinceMs) =>
  events.filter((e) => e.at >= sinceMs);

// 1) Login
async function login() {
  // Берём первого dev-юзера.
  const usersRes = await fetch(`${API}/v1/_dev/users`);
  if (!usersRes.ok) {
    throw new Error(
      `dev/users failed: ${usersRes.status} (api запущен в NODE_ENV=production?)`,
    );
  }
  const users = await usersRes.json();
  if (users.length === 0) throw new Error("нет dev-юзеров в БД");
  const user = users[0];
  info(`логинимся как ${user.email}`);

  const loginRes = await fetch(`${API}/v1/_dev/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: user.id }),
  });
  if (!loginRes.ok) {
    throw new Error(`_dev/login failed: ${loginRes.status}`);
  }
  // set-cookie может прийти несколькими хедерами; берём всё.
  const setCookie = loginRes.headers.getSetCookie?.()
    ?? [loginRes.headers.get("set-cookie")].filter(Boolean);
  const cookieHeader = setCookie
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookieHeader) throw new Error("auth cookie не получен");
  return cookieHeader;
}

// 2) Pick workspace
async function pickWorkspace(cookie) {
  const res = await fetch(`${API}/v1/workspaces`, { headers: { cookie } });
  if (!res.ok) throw new Error(`/workspaces failed: ${res.status}`);
  const ws = await res.json();
  if (ws.length === 0) throw new Error("нет workspace'ов");
  info(`workspace: ${ws[0].name} (${ws[0].id})`);
  return ws[0].id;
}

// 3) Subscribe to SSE through fetch streaming
async function subscribeSSE(cookie, wsId) {
  const url = `${API}/v1/workspaces/${wsId}/contact-stream`;
  log(`подключаемся к ${url}`);
  const res = await fetch(url, {
    headers: { cookie, accept: "text/event-stream" },
  });
  if (!res.ok) {
    throw new Error(`SSE failed: ${res.status} ${await res.text()}`);
  }
  if (!res.body) throw new Error("SSE без body");
  ok(`SSE подключён (status ${res.status})`);

  // Парсим SSE (event: X\ndata: Y\n\n)
  (async () => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        warn("SSE поток закрылся!");
        break;
      }
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const evt = {};
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) evt.event = line.slice(6).trim();
          else if (line.startsWith("data:")) evt.data = line.slice(5).trim();
        }
        if (evt.event === "contact" && evt.data) {
          try {
            recordEvent(JSON.parse(evt.data));
          } catch {
            log(`SSE non-JSON contact event: ${evt.data}`);
          }
        } else if (evt.event === "ping") {
          // тихо
        } else if (evt.event) {
          log(`SSE другой event: ${evt.event} ${evt.data || ""}`);
        }
      }
    }
  })().catch((e) => err(`SSE цикл упал: ${e.message}`));
}

// 4) Сценарий
async function runScenario() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ask = (q) => rl.question(`${COLOR.yellow}? ${q}${COLOR.reset} `);

  console.log("\n=== Шаг 1 ===");
  await ask(
    "Открой канбан в браузере (/w/{wsId}/contacts) и убедись что страница загрузилась. [Enter]",
  );

  console.log("\n=== Шаг 2: первая порция входящих ===");
  let t0 = Date.now();
  events = [];
  await ask(
    "Сейчас отправь себе 2 входящих с другого TG-аккаунта. Подожди ~5 сек после последнего. [Enter] когда сделал",
  );
  let got = eventsSince(t0);
  if (got.length >= 2) {
    ok(`пришло ${got.length} SSE events — listener жив`);
  } else if (got.length === 1) {
    warn(
      `пришло только ${got.length} event (ожидалось 2). Может, контакта нет в БД или incoming пришёл с другого peer.`,
    );
  } else {
    err(
      "0 events. Listener мёртв или контакта нет в БД. Скопируй сюда последние 30 строк из терминала pnpm dev.",
    );
    rl.close();
    return;
  }

  console.log("\n=== Шаг 3: открываем чат и читаем ===");
  t0 = Date.now();
  events = [];
  await ask(
    "Открой карточку контакта в CRM (по клику на канбане), нажми 'Открыть чат'. [Enter] когда увидел чат",
  );
  got = eventsSince(t0);
  const zeroes = got.filter((e) => e.payload.unreadCount === 0);
  if (zeroes.length > 0) {
    ok(
      `пришёл event с unreadCount=0 (${zeroes.length}шт) — mark-read сработал`,
    );
  } else {
    warn(
      "не пришло event с unreadCount=0. Mark-read mutation либо не дёрнулась, либо emit не сработал.",
    );
  }

  console.log("\n=== Шаг 4: ответ из чата (опционально) ===");
  t0 = Date.now();
  events = [];
  await ask(
    "Ответь что-нибудь в открытом TG-чате внутри карточки (через iframe). [Enter] когда отправил",
  );
  // Тут события могут не приходить — outgoing нас не интересует.
  log(`за этот шаг events: ${eventsSince(t0).length}`);

  console.log("\n=== Шаг 5: закрываем чат, шлём новые входящие ===");
  await ask(
    "Закрой карточку (вернись на канбан). [Enter] когда вернулся",
  );
  t0 = Date.now();
  events = [];
  await ask(
    "Сейчас отправь себе 2 входящих с другого TG-аккаунта. Подожди ~15 сек после последнего (10с tick + запас). [Enter] когда подождал",
  );
  got = eventsSince(t0);
  if (got.length >= 2) {
    ok(
      `пришло ${got.length} events — listener выжил после iframe-эпизода. Баг НЕ воспроизвёлся.`,
    );
  } else if (got.length === 1) {
    warn(
      `пришёл только ${got.length} event. Частичная потеря — listener живой, но что-то режется.`,
    );
  } else {
    err(
      "0 events. Listener умер после iframe-эпизода. Скопируй сюда последние 50 строк из терминала pnpm dev — найдём почему.",
    );
  }

  console.log("\n=== Готово ===");
  info("Все собранные events:");
  for (const e of events) {
    console.log(
      `  ${COLOR.dim}${new Date(e.at).toISOString().slice(11, 23)}${COLOR.reset} ${JSON.stringify(e.payload)}`,
    );
  }
  rl.close();
}

(async () => {
  try {
    const cookie = await login();
    ok("логин ОК");
    const wsId = await pickWorkspace(cookie);
    await subscribeSSE(cookie, wsId);
    // Дадим SSE подключиться полностью.
    await new Promise((r) => setTimeout(r, 500));
    await runScenario();
  } catch (e) {
    err(`${e.message}`);
    process.exit(1);
  }
})();

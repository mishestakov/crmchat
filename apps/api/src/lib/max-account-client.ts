import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { outreachAccounts } from "../db/schema.ts";
import { shortId } from "../db/short-id.ts";
import {
  connectSession,
  MaxClient,
  MaxClientError,
  newDeviceId,
  pickLoginToken,
  pickPasswordTrackId,
  selfIdFromLogin,
  sessionInit,
  type MaxResponse,
} from "./max/index.ts";

// MAX-аккаунт = один живой TLS-сокет (как один TDLib-инстанс на TG-аккаунт),
// но сессия — это просто { deviceId, loginToken } в БД, без FS-состояния.
// Зеркало outreach-account-client.ts под платформу max. Auth-флоу подтверждён
// живой пробой (см. project_max_integration в памяти):
//   SESSION_INIT → AUTH_REQUEST(phone) → AUTH(code) → [AUTH_LOGIN_CHECK_PASSWORD] → LOGIN

// --- pending auth-сессия (между HTTP-вызовами send-code → sign-in) ---

type MaxPending = {
  client: MaxClient;
  deviceId: string;
  phone: string;
  verifyToken?: string;
  trackId?: string;
  loginToken?: string;
  createdAt: number;
};

const pendingByWorkspace = new Map<string, MaxPending>();
const PENDING_TTL_MS = 5 * 60_000;

// --- worker-сокеты per-account (ленивые, для парсинга/отправки) ---

const workerClients = new Map<string, MaxClient>();
const workerInflight = new Map<string, Promise<MaxClient>>();

// Хук, вызываемый при создании нового воркер-клиента (max-conversation вешает
// inbound-listener). Держим тут, а не импортим max-conversation — иначе цикл.
let clientCreatedHook:
  | ((accountId: string, client: MaxClient) => void)
  | null = null;
export function setMaxClientCreatedHook(
  fn: (accountId: string, client: MaxClient) => void,
): void {
  clientCreatedHook = fn;
}

function isExpired(p: MaxPending): boolean {
  return Date.now() - p.createdAt > PENDING_TTL_MS;
}

export async function clearPendingMaxClient(wsId: string): Promise<void> {
  const p = pendingByWorkspace.get(wsId);
  if (!p) return;
  pendingByWorkspace.delete(wsId);
  try {
    p.client.close();
  } catch {
    /* socket уже мёртв — не важно */
  }
}

// Шаг 1: создать сессию, отправить SMS. Свежий клиент каждый раз — прошлая
// попытка могла застрять на verify-state.
export async function maxSendCode(
  wsId: string,
  phone: string,
): Promise<{ status: "code_sent" }> {
  await clearPendingMaxClient(wsId);
  const deviceId = newDeviceId();
  const client = new MaxClient();
  await client.connect();
  await sessionInit(client, deviceId);
  const res = await client.authRequest(phone);
  const verifyToken = (res.payload as Record<string, unknown> | null)?.token;
  if (typeof verifyToken !== "string") {
    client.close();
    throw new Error("AUTH_REQUEST не вернул token");
  }
  pendingByWorkspace.set(wsId, {
    client,
    deviceId,
    phone,
    verifyToken,
    createdAt: Date.now(),
  });
  return { status: "code_sent" };
}

function getFreshPending(wsId: string): MaxPending {
  const p = pendingByWorkspace.get(wsId);
  if (!p || isExpired(p)) {
    if (p) void clearPendingMaxClient(wsId);
    throw new Error("Сессия авторизации истекла — запросите код заново");
  }
  return p;
}

export type MaxSignInResult =
  | { kind: "complete" }
  | { kind: "password_needed" }
  | { kind: "code_invalid" };

// Шаг 2: подтвердить SMS-код. Либо сразу loginToken, либо запрос пароля (2FA).
export async function maxSignInCode(
  wsId: string,
  code: string,
): Promise<MaxSignInResult> {
  const p = getFreshPending(wsId);
  if (!p.verifyToken) throw new Error("нет verifyToken в pending-сессии");
  let res: MaxResponse;
  try {
    res = await p.client.auth(p.verifyToken, code);
  } catch (e) {
    // cmd=3 от сервера на неверный код → трактуем как invalid, флоу можно повторить.
    if (e instanceof MaxClientError) return { kind: "code_invalid" };
    throw e;
  }
  const loginToken = pickLoginToken(res.payload);
  if (loginToken) {
    p.loginToken = loginToken;
    return { kind: "complete" };
  }
  const trackId = pickPasswordTrackId(res.payload);
  if (trackId) {
    p.trackId = trackId;
    return { kind: "password_needed" };
  }
  return { kind: "code_invalid" };
}

// Шаг 3 (опц.): пароль 2FA.
export async function maxSignInPassword(
  wsId: string,
  password: string,
): Promise<{ kind: "complete" } | { kind: "password_invalid" }> {
  const p = getFreshPending(wsId);
  if (!p.trackId) throw new Error("нет trackId — пароль не запрашивался");
  let res: MaxResponse;
  try {
    res = await p.client.authLoginCheckPassword(p.trackId, password);
  } catch (e) {
    if (e instanceof MaxClientError) return { kind: "password_invalid" };
    throw e;
  }
  const loginToken = pickLoginToken(res.payload);
  if (!loginToken) return { kind: "password_invalid" };
  p.loginToken = loginToken;
  return { kind: "complete" };
}

// Финал: LOGIN по токену (получаем профиль), upsert аккаунта. Сессия (deviceId +
// loginToken) хранится в БД для реконнекта — никакого FS-состояния.
export async function persistMaxAccount(
  wsId: string,
  userId: string,
): Promise<{ id: string }> {
  const p = getFreshPending(wsId);
  if (!p.loginToken) throw new Error("нет loginToken — авторизация не завершена");

  const login = await p.client.login(p.loginToken);
  const selfId = selfIdFromLogin(login.payload);
  if (!selfId) throw new Error("LOGIN не вернул profile.contact.id");

  const contact = (
    (login.payload as Record<string, unknown> | null)?.profile as
      | Record<string, unknown>
      | undefined
  )?.contact as Record<string, unknown> | undefined;
  const names = Array.isArray(contact?.names) ? contact!.names : [];
  const firstName =
    (names[0] as Record<string, unknown> | undefined)?.firstName ?? null;

  // pending-клиент больше не нужен (worker поднимется лениво при парсинге/отправке).
  await clearPendingMaxClient(wsId);

  const phoneNumber = p.phone.startsWith("+") ? p.phone : `+${p.phone}`;
  const name = typeof firstName === "string" ? firstName : null;

  // У MAX нет FS-состояния (в отличие от TG-мирора с .td-database), поэтому
  // отдельный pre-SELECT для finalId/rename не нужен: onConflictDoUpdate сам
  // отдаёт id выжившей строки, evict ниже — no-op если воркера в кэше нет.
  const [row] = await db
    .insert(outreachAccounts)
    .values({
      id: shortId(),
      workspaceId: wsId,
      platform: "max",
      externalUserId: selfId,
      externalUsername: null,
      phoneNumber,
      firstName: name,
      sessionToken: p.loginToken,
      meta: { deviceId: p.deviceId },
      ownerUserId: userId,
      createdBy: userId,
    })
    .onConflictDoUpdate({
      target: [
        outreachAccounts.workspaceId,
        outreachAccounts.platform,
        outreachAccounts.externalUserId,
      ],
      set: {
        phoneNumber,
        firstName: name,
        sessionToken: p.loginToken,
        meta: { deviceId: p.deviceId },
        status: "active",
        updatedAt: new Date(),
        // ownerUserId не трогаем при reconnect (как в TG-флоу).
      },
    })
    .returning({ id: outreachAccounts.id });

  // Сбрасываем возможный старый воркер реконнектнутого аккаунта.
  evictMaxWorkerClient(row!.id);
  return { id: row!.id };
}

// --- worker (ленивый реконнект по сохранённой сессии) ---

type MaxAccountRow = {
  id: string;
  sessionToken: string | null;
  meta: { deviceId?: string };
};

async function markMaxUnauthorized(accountId: string): Promise<void> {
  await db
    .update(outreachAccounts)
    .set({ status: "unauthorized", updatedAt: new Date() })
    .where(eq(outreachAccounts.id, accountId))
    .catch(() => {});
}

export function evictMaxWorkerClient(accountId: string): void {
  const c = workerClients.get(accountId);
  if (c) {
    workerClients.delete(accountId);
    try {
      c.close();
    } catch {
      /* ignore */
    }
  }
}

// Получить авторизованный сокет аккаунта (single-flight). Бросает если сессия
// мёртвая — вызывающий помечает аккаунт unauthorized.
export async function getMaxWorkerClient(account: MaxAccountRow): Promise<MaxClient> {
  const cached = workerClients.get(account.id);
  if (cached && cached.connected) return cached;

  const inflight = workerInflight.get(account.id);
  if (inflight) return inflight;

  const promise = (async () => {
    if (!account.sessionToken || !account.meta.deviceId) {
      throw new Error("у MAX-аккаунта нет сохранённой сессии");
    }
    const deviceId = account.meta.deviceId;
    const loginToken = account.sessionToken;
    const client = new MaxClient();
    // Самовосстановление (как withReconnect в ~/MAX): на сетевом сбое/half-open
    // операции клиент сам делает чистый реконнект тем же токеном и повторяет
    // запрос — сессия живёт, не падает на одном разрыве. FAIL_LOGIN_TOKEN при
    // реконнекте = токен реально мёртв → unauthorized + эвикт.
    client.setReconnectHook(async () => {
      client.close();
      try {
        await connectSession(client, { deviceId, loginToken });
      } catch (e) {
        if (e instanceof MaxClientError) {
          evictMaxWorkerClient(account.id);
          await markMaxUnauthorized(account.id);
        }
        throw e;
      }
    });
    try {
      await connectSession(client, { deviceId, loginToken });
    } catch (e) {
      client.close(); // не оставляем открытый сокет при провале login
      // Серверная ошибка (cmd=3, напр. FAIL_LOGIN_TOKEN) = сессия протухла →
      // помечаем unauthorized, чтобы UI предложил переподключить. Сетевые
      // ошибки (не MaxClientError) — транзиентные, статус не трогаем.
      if (e instanceof MaxClientError) {
        await markMaxUnauthorized(account.id);
      }
      throw e;
    }
    workerClients.set(account.id, client);
    // Хук «клиент создан» — max-conversation вешает inbound-listener на КАЖДЫЙ
    // новый инстанс (не только на warmup), иначе после reconnect/evict/позднего
    // подключения новый сокет остаётся без обработчика NOTIF_MESSAGE.
    clientCreatedHook?.(account.id, client);
    return client;
  })();

  workerInflight.set(account.id, promise);
  try {
    return await promise;
  } finally {
    workerInflight.delete(account.id);
  }
}

// --- адресация и отправка ЛС ---

// chatId диалога 1-на-1 детерминирован: XOR двух userId. Раскрыто реверсом
// (см. project_max_integration): contact.id напрямую как chatId НЕ работает,
// диалог адресуется self^peer. Отдельного «создать диалог» не нужно.
export function maxDialogChatId(selfUserId: string, peerUserId: string): string {
  return (BigInt(selfUserId) ^ BigInt(peerUserId)).toString();
}

// Резолвим получателя: ссылка max.ru/u/<token> → LINK_INFO → contact.id + имя
// (names[0].firstName+lastName); голый числовой id — как есть (имя null). Бросает
// если не резолвится. name нужен для подписи контакта-админа при привязке.
export async function resolveMaxContactRef(
  client: MaxClient,
  ref: string,
): Promise<{ userId: string; name: string | null; avatarUrl: string | null }> {
  const trimmed = ref.trim();
  if (/^-?\d+$/.test(trimmed))
    return { userId: trimmed, name: null, avatarUrl: null };
  const m = trimmed.match(/(?:max\.ru\/)?(u\/[A-Za-z0-9_-]+)/i);
  if (!m) throw new Error(`MAX: не распознал получателя: ${ref}`);
  const res = await client.linkInfo(m[1]!);
  const contact = (
    (res.payload as Record<string, unknown> | null)?.user as
      | Record<string, unknown>
      | undefined
  )?.contact as Record<string, unknown> | undefined;
  const userId = contact?.id;
  if (userId == null) throw new Error(`MAX: LINK_INFO не вернул contact.id для ${ref}`);
  const names = Array.isArray(contact?.names) ? contact.names : [];
  const n0 = names[0] as Record<string, unknown> | undefined;
  const first = typeof n0?.firstName === "string" ? n0.firstName : "";
  const last = typeof n0?.lastName === "string" ? n0.lastName : "";
  const name = [first, last].filter(Boolean).join(" ").trim() || null;
  // Аватар контакта (юзера) — baseUrl (i.oneme.ru); у каналов это baseIconUrl.
  const avatarUrl = typeof contact?.baseUrl === "string" ? contact.baseUrl : null;
  return { userId: String(userId), name, avatarUrl };
}

// Только userId (для send/history, где имя не нужно).
export async function resolveMaxPeerUserId(
  client: MaxClient,
  ref: string,
): Promise<string> {
  return (await resolveMaxContactRef(client, ref)).userId;
}

// Пир получателя из properties контакта: max_user_id (числовой id, шлём без сети)
// предпочтительнее max_link (резолвим LINK_INFO). fromUserId важен воркеру —
// решает, дописывать ли max_user_id контакту после резолва ссылки. Единый
// источник правды для аутрич-воркера, планировщика и contact-ручек.
export function maxPeerFromProps(
  props: unknown,
): { ref: string; fromUserId: boolean } | null {
  const p = props as Record<string, unknown> | null;
  const uid = typeof p?.max_user_id === "string" ? p.max_user_id : "";
  if (uid) return { ref: uid, fromUserId: true };
  const link = typeof p?.max_link === "string" ? p.max_link : "";
  if (link) return { ref: link, fromUserId: false };
  return null;
}

export function maxPeerRef(props: unknown): string | null {
  return maxPeerFromProps(props)?.ref ?? null;
}

type MaxSendAccount = {
  id: string;
  externalUserId: string;
  sessionToken: string | null;
  meta: { deviceId?: string };
};

// Отправка ЛС: резолв получателя → XOR-chatId → typing → MSG_SEND. peerRef —
// max.ru/u-ссылка или числовой userId. Возвращает id отправленного сообщения.
// Human-flow задержки (typing-пауза, post-send) — на стороне вызывающего воркера.
export async function sendMaxMessage(
  account: MaxSendAccount,
  peerRef: string,
  text: string,
): Promise<{ chatId: string; messageId: string | null }> {
  const client = await getMaxWorkerClient(account);
  const peerUserId = await resolveMaxPeerUserId(client, peerRef);
  const chatId = maxDialogChatId(account.externalUserId, peerUserId);
  await client.msgTyping(chatId).catch(() => {});
  const res = await client.msgSend(chatId, text);
  const message = (res.payload as Record<string, unknown> | null)?.message as
    | Record<string, unknown>
    | undefined;
  return { chatId, messageId: message?.id != null ? String(message.id) : null };
}

// TLS-клиент протокола MAX. Один инстанс = один живой сокет = один аккаунт
// (как один TDLib-инстанс на outreach-аккаунт). Порт из `~/MAX/src/transport/client.ts`:
// убран файловый логгер (не место в сервере) → опциональный onLog; добавлены
// методы отправки/контактов; onData огорожен от падения сокета на битом пакете.
import net from "node:net";
import tls from "node:tls";
import { EventEmitter, once } from "node:events";
import { buildPacket, tryParsePacket, type PacketHeader } from "./codec.ts";
import { OPCODES, opcodeName } from "./opcodes.ts";

// Опкоды рукопожатия — их шлёт сам reconnect-хук (SESSION_INIT/LOGIN). На них
// авто-реконнект отключаем, иначе рекурсия при переподключении.
const RECONNECT_SKIP_OPCODES = new Set<number>([
  OPCODES.SESSION_INIT,
  OPCODES.AUTH_REQUEST,
  OPCODES.AUTH,
  OPCODES.AUTH_LOGIN_CHECK_PASSWORD,
  OPCODES.LOGIN,
]);

export class MaxClientError extends Error {
  packet?: PacketHeader;
  payload?: unknown;
}

export interface MaxClientOptions {
  host?: string;
  port?: number;
  servername?: string;
  // Хук для отладочного лога (вход/выход пакетов). По умолчанию выключен.
  onLog?: (entry: { direction: "in" | "out"; packet: PacketHeader; payload: unknown }) => void;
}

export interface MaxResponse {
  packet: PacketHeader;
  payload: unknown;
}

function toInt64(value: unknown): bigint | unknown {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return value;
}

interface PendingRequest {
  opcode: number;
  resolve: (value: MaxResponse) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class MaxClient extends EventEmitter {
  private host: string;
  private port: number;
  private servername: string;
  private onLog?: MaxClientOptions["onLog"];
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextSeq = 1;
  private pending = new Map<number, PendingRequest>();
  // Самовосстановление (как withReconnect в ~/MAX): на сетевом сбое операции
  // клиент сам переподключается через этот хук и повторяет запрос. Ставит
  // getMaxWorkerClient (close → connectSession). reconnecting гасит рекурсию,
  // пока хук сам шлёт SESSION_INIT/LOGIN.
  private reconnectHook?: () => Promise<void>;
  private reconnecting = false;

  constructor(options: MaxClientOptions = {}) {
    super();
    this.host = options.host ?? "api.oneme.ru";
    this.port = options.port ?? 443;
    this.servername = options.servername ?? this.host;
    this.onLog = options.onLog;
  }

  setReconnectHook(fn: () => Promise<void>): void {
    this.reconnectHook = fn;
  }

  async connect(): Promise<void> {
    this.socket = tls.connect({ host: this.host, port: this.port, servername: this.servername });
    // keepAlive: иначе half-open разрыв без FIN (NAT/idle) не даёт ни 'error',
    // ни 'close' → destroyed остаётся false и кэш отдаёт мёртвый клиент часами.
    this.socket.setKeepAlive(true, 30_000);
    this.socket.on("data", (chunk: Buffer) => this.onData(chunk));
    this.socket.on("error", (error: Error) => this.rejectAll(error));
    this.socket.on("close", () => this.rejectAll(new Error("Socket closed")));
    await once(this.socket, "secureConnect");
    this.emit("connected");
  }

  close(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.rejectAll(new Error("Client closed"));
  }

  get connected(): boolean {
    return this.socket != null && !this.socket.destroyed;
  }

  // --- Auth ---

  sessionInit(session: unknown) {
    return this.sendRequest(OPCODES.SESSION_INIT, session);
  }

  authRequest(phone: string) {
    return this.sendRequest(OPCODES.AUTH_REQUEST, { phone, type: "START_AUTH" });
  }

  auth(verifyToken: string, verifyCode: string) {
    return this.sendRequest(OPCODES.AUTH, { token: verifyToken, verifyCode, authTokenType: "CHECK_CODE" });
  }

  authLoginCheckPassword(trackId: string, password: string) {
    return this.sendRequest(OPCODES.AUTH_LOGIN_CHECK_PASSWORD, { trackId, password });
  }

  login(token: string, options: { chatsCount?: number; chatsSync?: number; contactsSync?: number } = {}) {
    return this.sendRequest(OPCODES.LOGIN, {
      interactive: true,
      token,
      chatsCount: options.chatsCount ?? 40,
      chatsSync: options.chatsSync ?? 0,
      contactsSync: options.contactsSync ?? 0,
      presenceSync: 0,
      draftsSync: 0,
    });
  }

  // --- Read (parsing / channels) ---

  profile() {
    return this.sendRequest(OPCODES.PROFILE, {});
  }

  chatsInfo(chatIds: (number | bigint | string)[]) {
    return this.sendRequest(OPCODES.CHAT_INFO, { chatIds: chatIds.map(toInt64) });
  }

  chatHistory(
    chatId: number | bigint | string,
    options: {
      from?: number | bigint | string;
      backward?: number;
      backwardTime?: number | bigint | string;
      getChat?: boolean;
      getMessages?: boolean;
    } = {},
  ) {
    // from = якорь (пагинируем назад). По умолчанию «сейчас» → свежие сообщения
    // (from:0 вернул бы пусто — это была причина пустого reach). Как в ~/MAX.
    return this.sendRequest(OPCODES.CHAT_HISTORY, {
      chatId: toInt64(chatId),
      from: toInt64(options.from ?? Date.now()),
      forward: 0,
      forwardTime: 0n,
      backward: options.backward ?? 50,
      backwardTime: toInt64(options.backwardTime ?? 0),
      getChat: options.getChat ?? true,
      getMessages: options.getMessages ?? true,
      itemType: "REGULAR",
      interactive: true,
    });
  }

  publicSearch(query: string, options: { count?: number; type?: string; marker?: number | bigint | string } = {}) {
    const payload: Record<string, unknown> = { query, count: options.count ?? 20, type: options.type ?? "ALL" };
    if (options.marker != null) payload.marker = toInt64(options.marker);
    return this.sendRequest(OPCODES.PUBLIC_SEARCH, payload);
  }

  linkInfo(link: string) {
    return this.sendRequest(OPCODES.LINK_INFO, { link });
  }

  contactByPhone(phone: string) {
    return this.sendRequest(OPCODES.CONTACT_INFO_BY_PHONE, { phone });
  }

  // Вступить в канал по ссылке (закрытые каналы). Ответ { chat } — если есть
  // joinTime, вступление прошло; иначе может требоваться одобрение админа.
  chatJoin(link: string) {
    return this.sendRequest(OPCODES.CHAT_JOIN, { link });
  }

  chatSubscribe(chatId: number | bigint | string, subscribe = true) {
    return this.sendRequest(OPCODES.CHAT_SUBSCRIBE, { chatId: toInt64(chatId), subscribe });
  }

  msgGetStat(chatId: number | bigint | string, messageIds: (number | bigint | string)[]) {
    return this.sendRequest(OPCODES.MSG_GET_STAT, {
      chatId: toInt64(chatId),
      messageIds: messageIds.map(toInt64),
    });
  }

  // --- Send (ЛС, Фаза 3) ---

  msgTyping(chatId: number | bigint | string) {
    return this.sendRequest(OPCODES.MSG_TYPING, { chatId: toInt64(chatId) });
  }

  msgSend(chatId: number | bigint | string, text: string, options: { cid?: number; notify?: boolean } = {}) {
    return this.sendRequest(OPCODES.MSG_SEND, {
      chatId: toInt64(chatId),
      notify: options.notify ?? true,
      message: {
        attaches: [],
        // cid должен быть ЦЕЛЫМ (int64). С useBigInt64 обычный number кодируется
        // float64 (0xcb) → сервер «Expected number». BigInt → int64 (0xd3).
        cid: BigInt(options.cid ?? Date.now()),
        elements: [],
        text,
      },
    });
  }

  // --- Core ---

  async sendRequest(opcode: number, payload: unknown, options: { cmd?: number; timeoutMs?: number } = {}): Promise<MaxResponse> {
    try {
      return await this.sendOnce(opcode, payload, options);
    } catch (e) {
      // Серверная валидационная ошибка (cmd=3, напр. FAIL_LOGIN_TOKEN) — НЕ
      // сетевая, реконнект не поможет. Auth-опкоды (их шлёт сам хук) и повторный
      // вход во время реконнекта — пропускаем. Иначе: один чистый реконнект и
      // повтор (как withReconnect в ~/MAX) — переживаем half-open/идл-разрыв.
      if (
        !this.reconnectHook ||
        this.reconnecting ||
        e instanceof MaxClientError ||
        RECONNECT_SKIP_OPCODES.has(opcode)
      ) {
        throw e;
      }
      this.reconnecting = true;
      try {
        await this.reconnectHook();
      } finally {
        this.reconnecting = false;
      }
      return this.sendOnce(opcode, payload, options);
    }
  }

  private sendOnce(opcode: number, payload: unknown, options: { cmd?: number; timeoutMs?: number } = {}): Promise<MaxResponse> {
    if (!this.socket) return Promise.reject(new Error("Not connected"));
    const seq = this.allocateSeq();
    const cmd = options.cmd ?? 0;
    const packet = buildPacket({ cmd, seq, opcode, payload });
    this.onLog?.({
      direction: "out",
      packet: { version: 10, cmd, seq, opcode, opcodeName: opcodeName(opcode), compressionFactor: 0, payloadLength: packet.length - 10, inflatedLength: packet.length - 10 },
      payload,
    });

    return new Promise<MaxResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`Timeout waiting for ${opcodeName(opcode)} response`));
      }, options.timeoutMs ?? 15000);
      this.pending.set(seq, { opcode, resolve, reject, timeout });
      this.socket!.write(packet);
    });
  }

  private allocateSeq(): number {
    const seq = this.nextSeq & 0xffff;
    this.nextSeq = (seq + 1) & 0xffff;
    return seq;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      let parsed: ReturnType<typeof tryParsePacket>;
      try {
        parsed = tryParsePacket(this.buffer);
      } catch (err) {
        // Кодек не должен бросать (decodePayload безопасен), но если фрейминг
        // сполз — не роняем сокет: эмитим ошибку и сбрасываем буфер.
        this.emit("parse-error", err);
        this.buffer = Buffer.alloc(0);
        return;
      }
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.consumed);
      this.onLog?.({ direction: "in", packet: parsed.packet, payload: parsed.decoded });
      this.handlePacket(parsed.packet, parsed.decoded);
    }
  }

  private handlePacket(packet: PacketHeader, payload: unknown): void {
    this.emit("packet", { packet, payload });
    if (packet.cmd === 0) {
      this.emit("notify", { packet, payload });
      return;
    }
    const pending = this.pending.get(packet.seq);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(packet.seq);

    if (packet.cmd === 3) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as Record<string, unknown>).message)
          : `${opcodeName(packet.opcode)} failed`;
      const error = new MaxClientError(message);
      error.packet = packet;
      error.payload = payload;
      pending.reject(error);
      return;
    }
    pending.resolve({ packet, payload });
  }

  private rejectAll(error: Error): void {
    for (const [seq, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(seq);
    }
  }
}

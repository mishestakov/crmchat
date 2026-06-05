// Опкоды клиентского протокола MAX (api.oneme.ru). Реверс — источник правды
// `~/max1/lib/docs/opcodes/` + `~/MAX/src/transport/opcodes.ts`. Числа —
// hex как в APK. Держим только то, что реально используем + соседей для отладки.
export const OPCODES = {
  PING: 0x01,
  RECONNECT: 0x03,
  SESSION_INIT: 0x06,
  PROFILE: 0x10,
  AUTH_REQUEST: 0x11,
  AUTH: 0x12,
  LOGIN: 0x13,
  LOGOUT: 0x14,
  SYNC: 0x15,
  CONTACT_INFO: 0x20,
  CONTACT_INFO_BY_PHONE: 0x2e,
  AUTH_LOGIN_CHECK_PASSWORD: 0x73,
  CHAT_INFO: 0x30,
  CHAT_HISTORY: 0x31,
  CHAT_MARK: 0x32,
  CHATS_LIST: 0x35,
  CHAT_JOIN: 0x39,
  CHAT_LEAVE: 0x3a,
  CHAT_MEMBERS: 0x3b,
  PUBLIC_SEARCH: 0x3c,
  CHAT_CREATE: 0x3f,
  MSG_SEND: 0x40,
  MSG_TYPING: 0x41,
  MSG_DELETE: 0x42,
  MSG_EDIT: 0x43,
  CHAT_SEARCH: 0x44,
  MSG_SEARCH: 0x49,
  MSG_GET_STAT: 0x4a,
  CHAT_SUBSCRIBE: 0x4b,
  LINK_INFO: 0x59,
  MSG_GET_REACTIONS: 0xb4,
  MSG_GET_DETAILED_REACTIONS: 0xb5,
  // server → client (cmd=0)
  NOTIF_MESSAGE: 0x80,
  NOTIF_PRESENCE: 0x84,
  NOTIF_REACTION_COUNTERS: 0x9b,
} as const;

const OPCODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OPCODES).map(([name, code]) => [code, name]),
);

export function opcodeName(opcode: number): string {
  return OPCODE_NAMES[opcode] ?? `0x${opcode.toString(16)}`;
}

import { EventEmitter } from "node:events";

// In-process pub/sub для contact-апдейтов: outreach-listener эмитит на каждое
// входящее DM от контакта (unread++), mark-read endpoint эмитит на сброс.
// SSE-стрим /contacts/stream пересылает подписанным клиентам канбана.
//
// Гранулярность — workspaceId (один EventSource на открытую страницу канбана).
// Для multi-instance prod — заменить на Postgres LISTEN/NOTIFY либо Redis.

export type ContactEvent = {
  contactId: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

const bus = new EventEmitter();
bus.setMaxListeners(0);

const channel = (wsId: string) => `ws:${wsId}`;

export function emitContactChanged(wsId: string, payload: ContactEvent): void {
  bus.emit(channel(wsId), payload);
}

export function subscribeContacts(
  wsId: string,
  cb: (payload: ContactEvent) => void,
): () => void {
  const ch = channel(wsId);
  bus.on(ch, cb);
  return () => bus.off(ch, cb);
}

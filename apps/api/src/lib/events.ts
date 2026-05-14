import { EventEmitter } from "node:events";

// In-process pub/sub для SSE-стримов. Два независимых канала:
//   project:<projectId>  — апдейты scheduled_messages в /projects/{id}/stream.
//   ws:<wsId>            — апдейты контактов (unread/lastMessageAt) в
//                          /contacts/stream.
// Multi-instance prod потребует Postgres LISTEN/NOTIFY или Redis; пока
// single-instance — EventEmitter достаточно.

const bus = new EventEmitter();
// MaxListeners=10 не хватает: открытых SSE-страниц у воркспейса может быть
// больше одной (несколько вкладок, несколько менеджеров).
bus.setMaxListeners(0);

function createChannel<T>(prefix: string) {
  const key = (id: string) => `${prefix}:${id}`;
  return {
    emit: (id: string, payload: T) => {
      bus.emit(key(id), payload);
    },
    subscribe: (id: string, cb: (payload: T) => void) => {
      const ch = key(id);
      bus.on(ch, cb);
      return () => bus.off(ch, cb);
    },
  };
}

const projectChannel = createChannel<void>("project");
export const emitProjectChanged = (projectId: string) =>
  projectChannel.emit(projectId, undefined);
export const subscribeProject = (projectId: string, cb: () => void) =>
  projectChannel.subscribe(projectId, cb);

export type ContactEvent = {
  contactId: string;
  unreadCount: number;
  lastMessageAt: string | null;
};
const contactChannel = createChannel<ContactEvent>("ws");
export const emitContactChanged = (
  wsId: string,
  payload: ContactEvent,
) => contactChannel.emit(wsId, payload);
export const subscribeContacts = (
  wsId: string,
  cb: (payload: ContactEvent) => void,
) => contactChannel.subscribe(wsId, cb);

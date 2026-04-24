import { EventEmitter } from "node:events";

// In-process pub-sub для outreach-апдейтов: воркер и listener эмитят событие
// на запись (sent/failed/cancelled/replied), SSE-handler пересылает подписанным
// клиентам. Гранулярность — sequenceId; ровно один EventSource на открытую
// страницу sequence detail.
//
// Не годится для multi-instance prod: эмиты в реплике A не дойдут до подписчиков
// реплики B. Replacement: Postgres LISTEN/NOTIFY (workspace-channel + JSON
// payload), Redis Pub/Sub, или Postgres-row-version-watch (отдельный sweep).
// Пока single-instance — EventEmitter достаточно.

const bus = new EventEmitter();
// Подписчиков может быть много (по одной странице sequence detail). Дефолтный
// MaxListeners=10 — не наш кейс.
bus.setMaxListeners(0);

const channel = (seqId: string) => `seq:${seqId}`;

export function emitSequenceChanged(seqId: string) {
  bus.emit(channel(seqId));
}

export function subscribeSequence(
  seqId: string,
  cb: () => void,
): () => void {
  const ch = channel(seqId);
  bus.on(ch, cb);
  return () => bus.off(ch, cb);
}

import { EventEmitter } from "node:events";

// In-process pub-sub для project-апдейтов: воркер и listener эмитят событие
// на запись (sent/failed/cancelled/replied), SSE-handler пересылает подписанным
// клиентам. Гранулярность — projectId; ровно один EventSource на открытую
// страницу проекта.
//
// Не годится для multi-instance prod: эмиты в реплике A не дойдут до подписчиков
// реплики B. Replacement: Postgres LISTEN/NOTIFY (workspace-channel + JSON
// payload), Redis Pub/Sub, или Postgres-row-version-watch (отдельный sweep).
// Пока single-instance — EventEmitter достаточно.

const bus = new EventEmitter();
// Подписчиков может быть много (по одной странице project detail). Дефолтный
// MaxListeners=10 — не наш кейс.
bus.setMaxListeners(0);

const channel = (projectId: string) => `project:${projectId}`;

export function emitProjectChanged(projectId: string) {
  bus.emit(channel(projectId));
}

export function subscribeProject(
  projectId: string,
  cb: () => void,
): () => void {
  const ch = channel(projectId);
  bus.on(ch, cb);
  return () => bus.off(ch, cb);
}

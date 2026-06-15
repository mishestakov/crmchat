import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

// Единая обёртка над streamSSE для всех SSE-эндпоинтов. Ставит
// X-Accel-Buffering: no — иначе nginx с дефолтным proxy_buffering on копит
// мелкие кадры в буфере и не отдаёт их браузеру: QR-success «застревает»,
// живые апдейты ленты (новые сообщения, счётчики, unread) не доезжают, хотя
// данные в БД есть. Источник правды один — новый SSE-эндпоинт получает
// заголовок автоматически, а не забывает его и не воспроизводит баг.
export function streamSSENoBuffer(
  c: Context,
  cb: Parameters<typeof streamSSE>[1],
) {
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, cb);
}

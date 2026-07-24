// Общие для роутов кампании (campaigns/*) схемы — >1 файла-потребителя:
// параметры пути и ссылка на помеченное сообщение чата.
import { z } from "@hono/zod-openapi";

export const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});
export const PlacementParam = WsProjectParam.extend({
  placementId: z.string().min(1).max(64),
});

// Ссылка на помеченное сообщение в чате (договор/креатив/акт). albumId !=null →
// сервер дочитает весь альбом при рендере (media_album_id). Файлы не храним.
export const MsgRefSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  albumId: z.string().nullable(),
  accountId: z.string(),
  at: z.iso.datetime(),
});

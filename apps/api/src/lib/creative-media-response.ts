import { HTTPException } from "hono/http-exception";
import type { TdClient } from "./tdlib/client.ts";
import { readTaggedMessages } from "./channel-history.ts";
import { extractCreativeMedia } from "./td-message.ts";
import { downloadToBytes } from "./td-files.ts";

// Общий путь отдачи медиа поста/креатива в норм-разрешении: помеченное
// сообщение → его медиа (фото/видео-постер) → байты с TDLib on-demand, не храним.
// Один источник для трёх роутов: клиентский портал (creative-media), превью у
// менеджера (step-media), лента канала (post-media). Различается только то, как
// каждый резолвит client + ref (auth/lookup) — это остаётся в роутах.
export async function respondWithCreativeMedia(
  client: TdClient,
  ref: { chatId: string; messageId: string; albumId: string | null },
  idx: number,
): Promise<Response> {
  const msgs = await readTaggedMessages(client, ref);
  const m = msgs[idx];
  const media = m && extractCreativeMedia(m.content);
  if (!media) throw new HTTPException(404, { message: "not found" });
  const bytes = await downloadToBytes(client, media.fileId);
  if (!bytes) throw new HTTPException(404, { message: "media unavailable" });
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=300",
    },
  });
}

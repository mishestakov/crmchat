import { createApiClient } from "@repo/api-client";

// В dev vite проксирует /v1 → http://localhost:3000 (см. vite.config.ts).
// baseUrl пустой → fetch идёт на тот же origin, cookie летят без CORS-преамбулы.
export const api = createApiClient("");

// Отправка файлов в чат контакта. Multipart-роут вне OpenAPI → raw fetch
// (typed-клиент не покрывает FormData). Бросает с текстом ошибки. Инвалидацию
// query делает вызывающий — scope отличается между местами. asFile=true → всё
// документом без пережатия; иначе картинки уходят сжатыми. caption — подпись.
export async function sendContactMedia(
  wsId: string,
  contactId: string,
  accountId: string,
  files: File[],
  asFile: boolean,
  caption: string,
  replyToMessageId?: string,
): Promise<void> {
  const fd = new FormData();
  for (const f of files) fd.append("file", f);
  fd.append("accountId", accountId);
  fd.append("asFile", String(asFile));
  if (caption) fd.append("caption", caption);
  if (replyToMessageId) fd.append("replyToMessageId", replyToMessageId);
  const res = await fetch(
    `/v1/workspaces/${wsId}/contacts/${contactId}/send-media`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error((await res.text().catch(() => "")) || "Ошибка отправки");
  }
}

// Один файл документом (drag-drop договора в placement-drawer). Обёртка над
// sendContactMedia: asFile=true → отправка файлом без пережатия картинок.
export function sendContactDocument(
  wsId: string,
  contactId: string,
  accountId: string,
  file: File,
): Promise<void> {
  return sendContactMedia(wsId, contactId, accountId, [file], true, "");
}

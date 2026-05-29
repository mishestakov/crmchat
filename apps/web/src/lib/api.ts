import { createApiClient } from "@repo/api-client";

// В dev vite проксирует /v1 → http://localhost:3000 (см. vite.config.ts).
// baseUrl пустой → fetch идёт на тот же origin, cookie летят без CORS-преамбулы.
export const api = createApiClient("");

// Отправка файла документом в чат контакта. Multipart-роут вне OpenAPI →
// raw fetch (typed-клиент не покрывает FormData). Бросает с текстом ошибки.
// Инвалидацию query делает вызывающий — scope отличается между местами.
export async function sendContactDocument(
  wsId: string,
  contactId: string,
  accountId: string,
  file: File,
): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("accountId", accountId);
  const res = await fetch(
    `/v1/workspaces/${wsId}/contacts/${contactId}/send-document`,
    { method: "POST", body: fd },
  );
  if (!res.ok) {
    throw new Error((await res.text().catch(() => "")) || "Ошибка отправки");
  }
}

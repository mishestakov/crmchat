import { writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TdClient } from "./tdlib/client.ts";

// Имя документа в Telegram = basename пути inputFileLocal. Уникальность даёт
// temp-ДИРЕКТОРИЯ (mkdtemp), а сам файл сохраняем под оригинальным именем (режем
// только разделители путей) — у блогера имя остаётся чистым, без uuid-префикса.
function safeBaseName(name: string): string {
  return name.replace(/[/\\]/g, "_").trim() || "file";
}

// Отправка файла документом в чат через TDLib. TDLib берёт АБСОЛЮТНЫЙ путь к
// файлу (inputFileLocal) и грузит его на сервер ФОНОВО — поэтому temp нельзя
// удалять сразу после sendMessage (оборвём загрузку); чистим с задержкой.
// id отправленного сообщения временный (меняется при доставке) и здесь НЕ нужен:
// пометка тегом (договор/акт) делается вручную из чата, когда у сообщения уже
// финальный id (осознанно не связываемся с временными id — 80/20).
export async function sendDocument(
  client: TdClient,
  chatId: number,
  bytes: Uint8Array,
  fileName: string,
  caption: string,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tgdoc-"));
  const path = join(dir, safeBaseName(fileName));
  await writeFile(path, bytes);
  const cleanup = () => void rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    await client.invoke({
      _: "sendMessage",
      chat_id: chatId,
      input_message_content: {
        _: "inputMessageDocument",
        document: { _: "inputFileLocal", path },
        thumbnail: null,
        disable_content_type_detection: false,
        caption: { _: "formattedText", text: caption, entities: [] },
      },
    } as never);
  } catch (e) {
    cleanup();
    throw e;
  }
  // upload идёт в фоне → удаляем temp с запасом, не блокируя ответ.
  setTimeout(cleanup, 5 * 60 * 1000).unref();
}

// Скачать файл TDLib в байты (для отдачи клиенту: фото креатива в норм-разрешении,
// не minithumbnail). synchronous:true → ждём завершения; limit:0 → весь файл
// (td_api.tl §downloadFile). TDLib кэширует локально, повторные вызовы быстрые.
// null — если не скачалось.
export async function downloadToBytes(
  client: TdClient,
  fileId: number,
): Promise<Uint8Array | null> {
  try {
    const file = (await client.invoke({
      _: "downloadFile",
      file_id: fileId,
      priority: 16,
      offset: 0,
      limit: 0,
      synchronous: true,
    } as never)) as {
      local?: { path?: string; is_downloading_completed?: boolean };
    };
    const path = file.local?.path;
    if (!path || !file.local?.is_downloading_completed) return null;
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

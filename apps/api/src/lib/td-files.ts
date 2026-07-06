import { writeFile, readFile, rm, mkdtemp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TdClient } from "./tdlib/client.ts";

// Имя документа в Telegram = basename пути inputFileLocal. Уникальность даёт
// temp-ДИРЕКТОРИЯ (mkdtemp), а сам файл сохраняем под оригинальным именем (режем
// только разделители путей) — у блогера имя остаётся чистым, без uuid-префикса.
function safeBaseName(name: string): string {
  return name.replace(/[/\\]/g, "_").trim() || "file";
}

export type OutgoingFile = { bytes: Uint8Array; name: string; mime: string };

// Картинку шлём как inputMessagePhoto (TG пережимает, показывает инлайн-фото)
// или как inputMessageDocument (оригинал, качается файлом). Выбор — чекбокс
// «Отправить файлом» во фронте (asFile). Не-картинки всегда документ.
function isPhoto(f: OutgoingFile, asFile: boolean): boolean {
  return !asFile && f.mime.startsWith("image/");
}

// caption (formattedText: текст + entities форматирования) вешаем только на
// первый месседж (для альбома TG показывает подпись под всем альбомом).
// Остальные получают пустой EMPTY_CAPTION.
export type Caption = { text: string; entities: unknown[] };
const EMPTY_CAPTION: Caption = { text: "", entities: [] };

function mediaContent(path: string, asPhoto: boolean, caption: Caption) {
  const cap = { _: "formattedText", text: caption.text, entities: caption.entities };
  // td_api.tl: файл обёрнут в inputPhoto/inputDocument, сам InputFile — ВНУТРИ.
  //   inputMessagePhoto photo:inputPhoto caption ... (5839)
  //   inputPhoto photo:InputFile thumbnail video added_sticker_file_ids width height (5674)
  //   inputMessageDocument document:inputDocument caption (5823)
  //   inputDocument document:InputFile thumbnail disable_content_type_detection (5665)
  // Раньше InputFile клали прямо в photo/document (плоско, старая схема) → TDLib
  // не находил вложенный InputFile: «InputFile is not specified», картинки не слались.
  return asPhoto
    ? {
        _: "inputMessagePhoto",
        photo: {
          _: "inputPhoto",
          photo: { _: "inputFileLocal", path },
          thumbnail: null,
          video: null,
          added_sticker_file_ids: [],
          // 0/0 — TDLib сам прочитает размеры из файла.
          width: 0,
          height: 0,
        },
        caption: cap,
        show_caption_above_media: false,
        self_destruct_type: null,
        has_spoiler: false,
      }
    : {
        _: "inputMessageDocument",
        document: {
          _: "inputDocument",
          document: { _: "inputFileLocal", path },
          thumbnail: null,
          disable_content_type_detection: false,
        },
        caption: cap,
      };
}

// Отправка одного или нескольких файлов в чат через TDLib. TDLib берёт
// АБСОЛЮТНЫЙ путь (inputFileLocal) и грузит фоново — поэтому temp нельзя удалять
// сразу (оборвём загрузку), чистим с задержкой. id отправленных сообщений
// временные и здесь НЕ нужны (тег ставится вручную из чата после доставки).
//
// Группировка: 1 файл → sendMessage; 2–10 → sendMessageAlbum. Фото и документы
// в один альбом мешать НЕЛЬЗЯ (td_api: документы группируются только с
// документами) — шлём раздельными альбомами, фото первыми. Чанки по 10 (предел
// альбома). caption и reply_to — на самый первый отправленный месседж.
export async function sendMedia(
  client: TdClient,
  chatId: number,
  files: OutgoingFile[],
  asFile: boolean,
  caption: Caption,
  replyToMessageId?: number,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "tgmedia-"));
  const cleanup = () => void rm(dir, { recursive: true, force: true }).catch(() => {});
  try {
    // Каждый файл — в свою индекс-подпапку: имя в TG = basename, а уникальность
    // пути даёт папка (иначе одноимённые файлы перетёрли бы друг друга). Записи
    // независимы — пишем параллельно.
    const items = await Promise.all(
      files.map(async (f, i) => {
        const sub = join(dir, String(i));
        await mkdir(sub);
        const path = join(sub, safeBaseName(f.name));
        await writeFile(path, f.bytes);
        return { path, asPhoto: isPhoto(f, asFile) };
      }),
    );

    // Фото и документы — раздельными альбомами (td_api не даёт смешивать), фото
    // первыми; внутри типа чанки по 10 (предел альбома). caption — на самый
    // первый отправленный месседж, дальше пусто.
    const groups = [
      { asPhoto: true, paths: items.filter((it) => it.asPhoto).map((it) => it.path) },
      { asPhoto: false, paths: items.filter((it) => !it.asPhoto).map((it) => it.path) },
    ].filter((g) => g.paths.length > 0);

    // reply_to: InputMessageReplyTo (td_api), inputMessageReplyToMessage для
    // ответа в том же чате — только на первый отправленный месседж.
    const replyTo =
      replyToMessageId != null
        ? { _: "inputMessageReplyToMessage", message_id: replyToMessageId }
        : null;

    let firstUsed = false;
    for (const g of groups) {
      for (let i = 0; i < g.paths.length; i += 10) {
        const chunk = g.paths.slice(i, i + 10);
        const contents = chunk.map((p) => {
          const content = mediaContent(p, g.asPhoto, firstUsed ? EMPTY_CAPTION : caption);
          firstUsed = true;
          return content;
        });
        // caption/reply берёт только самый первый месседж; запоминаем ДО map'а.
        const isFirstSend = !replyTo ? false : i === 0 && g === groups[0];
        await client.invoke(
          (chunk.length === 1
            ? {
                _: "sendMessage",
                chat_id: chatId,
                ...(isFirstSend ? { reply_to: replyTo } : {}),
                input_message_content: contents[0],
              }
            : {
                _: "sendMessageAlbum",
                chat_id: chatId,
                ...(isFirstSend ? { reply_to: replyTo } : {}),
                input_message_contents: contents,
              }) as never,
        );
      }
    }
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

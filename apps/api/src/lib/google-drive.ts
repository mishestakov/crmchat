import { googleAccessToken } from "./google-docs.ts";

// Drive API (v3) через сервис-аккаунт — только то, что нужно для авто-создания
// доков согласования: создать пустой Google-док в папке Общего диска агентства
// и расшарить его клиенту. Сам текст пишет Docs API (google-docs.ts).
//
// Общий диск нужен из-за квоты: файл, созданный ботом в обычном My Drive,
// принадлежит боту (квоты ≈ 0 → ошибка); в Общем диске владелец — сам диск.
// Папку Общего диска, куда создаём, задаёт GOOGLE_DRIVE_FOLDER_ID.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DOC_MIME = "application/vnd.google-apps.document";

async function driveError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`Google Drive API ${res.status} (${what}): ${body.slice(0, 300)}`);
}

export function driveFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID не задан в окружении");
  return id;
}

// Создать пустой Google-док в папке Общего диска. Возвращает id и ссылку.
// supportsAllDrives — обязателен для операций в Общих дисках.
export async function createDocInFolder(
  title: string,
  folderId: string,
): Promise<{ id: string; url: string }> {
  const token = await googleAccessToken();
  const res = await fetch(`${DRIVE_API}/files?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: title, mimeType: DOC_MIME, parents: [folderId] }),
  });
  if (!res.ok) throw await driveError(res, "files.create");
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("Drive не вернул id созданного дока");
  return { id, url: `https://docs.google.com/document/d/${id}/edit` };
}

// Расшарить док «всем, у кого есть ссылка» — комментатор. Клиенту достаточно
// переслать ссылку, отдельная почта не нужна. best-effort: если политика
// организации запрещает внешний доступ, вернём ошибку — вызывающий решает, падать
// или продолжить (док всё равно создан, байер расшарит вручную).
export async function shareAnyoneCommenter(docId: string): Promise<void> {
  const token = await googleAccessToken();
  const res = await fetch(
    `${DRIVE_API}/files/${docId}/permissions?supportsAllDrives=true`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "commenter", type: "anyone" }),
    },
  );
  if (!res.ok) throw await driveError(res, "permissions.create");
}

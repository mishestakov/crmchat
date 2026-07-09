import { GoogleAuth } from "google-auth-library";

// Транспорт к Google Docs API v1 через сервис-аккаунт (пилот согласования
// креативов с агентством). Авторизация — единственное, что не делаем руками:
// GoogleAuth подписывает JWT (RS256) сервис-аккаунтом и кэширует/рефрешит
// access-token. Сами вызовы — сырой fetch (как youtube.ts), поверхность узкая:
// только documents.get + documents.batchUpdate.
//
// Доступ к конкретному доку выдаёт байер, расшаривая его на client_email
// сервис-аккаунта (см. GOOGLE_SA_KEY_FILE). Никаких OAuth/consent-screen.

const DOCS_API = "https://docs.googleapis.com/v1/documents";
// documents — читать/писать текст; drive — авто-создавать доки в Общем диске
// агентства и шарить их клиенту. SA видит только то, что ему расшарили, так что
// широкий drive-scope тут де-факто ограничен папкой Общего диска.
const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

let auth: GoogleAuth | null = null;
function getAuth(): GoogleAuth {
  if (!auth) {
    const keyFile = process.env.GOOGLE_SA_KEY_FILE;
    if (!keyFile) throw new Error("GOOGLE_SA_KEY_FILE не задан в окружении");
    auth = new GoogleAuth({ keyFile, scopes: SCOPES });
  }
  return auth;
}

// Access-token сервис-аккаунта (JWT подписывает/кэширует GoogleAuth). Общий для
// Docs и Drive вызовов.
export async function googleAccessToken(): Promise<string> {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("не удалось получить Google access-token");
  return token;
}

// Понятная ошибка на два ходовых кейса: 403 — док не расшарен на сервис-аккаунт
// (частая забывчивость байера), 404 — битая ссылка. SA-email в текст не зашиваем
// — его подставляет UI из конфига.
async function docsError(res: Response, documentId: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  if (res.status === 403) {
    return new Error(
      `нет доступа к документу ${documentId} — расшарьте его на наш сервис-аккаунт (редактор)`,
    );
  }
  if (res.status === 404) {
    return new Error(`документ ${documentId} не найден — проверьте ссылку`);
  }
  return new Error(`Google Docs API ${res.status}: ${body.slice(0, 300)}`);
}

// --- срез структуры documents.get, что реально читаем ----------------------
// Полная схема глубоко вложенная; нам нужны только текстовые прогоны абзацев.
// Нетекстовые элементы Docs подменяет на U+E907 внутри textRun.content.
export type DocsTextRun = { content?: string };
export type DocsParagraphElement = { textRun?: DocsTextRun };
export type DocsParagraphStyle = { namedStyleType?: string };
export type DocsParagraph = {
  elements?: DocsParagraphElement[];
  paragraphStyle?: DocsParagraphStyle;
};
export type DocsStructuralElement = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: DocsParagraph;
};
export type DocsDocument = {
  documentId: string;
  title?: string;
  body?: { content?: DocsStructuralElement[] };
};

// Плоский текст всего документа (склейка всех textRun.content по порядку).
export function docPlainText(doc: DocsDocument): string {
  let out = "";
  for (const el of doc.body?.content ?? []) {
    for (const pe of el.paragraph?.elements ?? []) {
      out += pe.textRun?.content ?? "";
    }
  }
  return out;
}

export async function getDoc(documentId: string): Promise<DocsDocument> {
  const token = await googleAccessToken();
  const res = await fetch(`${DOCS_API}/${documentId}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await docsError(res, documentId);
  return (await res.json()) as DocsDocument;
}

// requests — массив Docs API Request (insertText/deleteContentRange/…). Пустой
// массив — no-op (Docs отклоняет пустой batchUpdate). Тип requests намеренно
// широкий: билдеры реквестов живут в слое-оркестраторе секций.
export async function batchUpdate(
  documentId: string,
  requests: unknown[],
): Promise<void> {
  if (requests.length === 0) return;
  const token = await googleAccessToken();
  const res = await fetch(`${DOCS_API}/${documentId}:batchUpdate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw await docsError(res, documentId);
}

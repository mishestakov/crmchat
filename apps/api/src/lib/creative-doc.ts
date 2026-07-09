import type { DocsDocument } from "./google-docs.ts";

// Дифф креатива в Google-доке (пилот с агентством, модель «1 док = 1 креатив»).
// Секций/маркеров нет: весь текст дока — это один креатив. TDLib-чтение текста и
// вызовы Docs/Drive живут в роуте; сюда приходят готовые строки.

// Изменился ли текст дока против базлайна. Нормализуем края (Docs любит
// добавлять/убирать хвостовые переводы строк) — сравниваем обрезанные.
export function bodyChanged(current: string, baseline: string): boolean {
  return current.trim() !== baseline.trim();
}

// Requests для перезаписи всего body дока: снести существующее (кроме
// неудаляемого финального \n) и вставить новый текст. Индексы Docs API 1-based;
// endIndex последнего элемента body = позиция за финальным \n.
export function rewriteRequests(doc: DocsDocument, text: string): unknown[] {
  const content = doc.body?.content ?? [];
  const endIndex = content.reduce(
    (max, el) => Math.max(max, el.endIndex ?? 0),
    0,
  );
  const requests: unknown[] = [];
  // endIndex <= 2 → пустой док (только финальный \n), удалять нечего.
  if (endIndex > 2) {
    requests.push({
      deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } },
    });
  }
  requests.push({ insertText: { location: { index: 1 }, text } });
  return requests;
}

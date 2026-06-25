// Хватает ли пингов на серию длины n с чередованием текст/котик (нечётные
// позиции — текст, чётные — котик) и graceful-добором, БЕЗ повтора. Единая
// формула: UI-подсказка (фронт) и валидация сохранения формы (бэк) — чтобы
// правило чередования не разъехалось между слоями (§1.3 bd-autodogon).
export function canFillDunning(
  textCount: number,
  stickerCount: number,
  n: number,
): boolean {
  const oddPos = Math.ceil(n / 2);
  const evenPos = Math.floor(n / 2);
  const textShort = Math.max(0, oddPos - textCount);
  const stickerShort = Math.max(0, evenPos - stickerCount);
  const textSpare = Math.max(0, textCount - oddPos);
  const stickerSpare = Math.max(0, stickerCount - evenPos);
  return textShort <= stickerSpare && stickerShort <= textSpare;
}

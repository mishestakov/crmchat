// Форматтеры чисел, общие для кабинета (campaigns/-shared) и публичной
// клиентской страницы (routes/share.$token). Живут в lib/, чтобы share-страница
// не тянула код из приватной папки _authenticated/.../campaigns.

export function formatRub(n: number | null): string {
  if (n === null) return "—";
  // Рубли показываем целыми — округляем здесь, чтобы каллеры (цены из движка —
  // дробные float) не оборачивали каждый вызов в Math.round. CPV идёт отдельным
  // cpv() с копейками, его это не трогает.
  return Math.round(n).toLocaleString("ru-RU") + " ₽";
}

export function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(0) + "k";
  return String(n);
}

// CPV (cost per view) = цена / просмотры, ₽ за просмотр. Главный фильтр клиента;
// должен совпадать в кабинете и на клиентском портале — поэтому здесь.
export function cpv(price: number | null, views: number | null): string {
  if (price === null || views === null || views === 0) return "—";
  return (price / views).toFixed(2) + " ₽";
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

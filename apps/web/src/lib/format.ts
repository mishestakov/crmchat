// Форматтеры чисел, общие для кабинета (campaigns/-shared) и публичной
// клиентской страницы (routes/share.$token). Живут в lib/, чтобы share-страница
// не тянула код из приватной папки _authenticated/.../campaigns.

export function formatRub(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("ru-RU") + " ₽";
}

export function formatViews(n: number | null): string {
  if (n === null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(0) + "k";
  return String(n);
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

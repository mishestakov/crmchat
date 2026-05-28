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

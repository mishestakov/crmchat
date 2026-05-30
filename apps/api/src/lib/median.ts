// Медиана числового массива. Общая для TG-пути (channels.ts metricsFromMessages)
// и провайдеров (channel-providers/reach.ts) — оба считают «средний охват» как
// медиану просмотров и бэкают один meta-контракт (avg_reach/err). Пустой вход → null.
export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// Потолок на операцию без собственного дедлайна. Главный клиент — TDLib:
// зависший invoke (network / cold handshake) не settle'ится никогда, и await
// на нём вешает вызывающего насмерть. Гонка с таймером → reject уходит в catch.
//
// Таймер намеренно не гасим: Promise.race уже подписан на обе ветки, поздний
// reject проглатывается, а лишние 15 секунд живого таймера в долгоживущем
// процессе ничего не стоят.
export function withTimeout<T>(
  p: Promise<T>,
  label: string,
  ms: number,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timeout ${ms}ms`)), ms),
    ),
  ]);
}

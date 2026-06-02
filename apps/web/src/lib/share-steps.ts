// Контракт клиентского портала по этапам (?step в URL). Живёт в lib/, чтобы и
// публичная share-страница, и кабинет (campaigns) ссылались на один словарь —
// без auth→public-связи и без рассинхрона трёх голых литералов.
export type ShareStep = "bloggers" | "creatives" | "report";

export const SHARE_STEPS: ShareStep[] = ["bloggers", "creatives", "report"];

// Deep-link на конкретный этап. base — либо `/share/{token}` (кабинет), либо
// origin+pathname (портал). Единственный владелец сборки `?step=`.
export function shareDeepLink(base: string, step: ShareStep): string {
  return `${base}?step=${step}`;
}

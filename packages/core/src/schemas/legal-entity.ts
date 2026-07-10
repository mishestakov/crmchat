import { z } from "zod";

// Юрлицо/контрагент — форма 1:1 с ОРД «Организация». Здесь живёт ПУРЕ-логика
// (тип, валидация ИНН, сборка строки маркировки); request/response-схемы роута —
// в apps/api/src/routes/legal-entities.ts. type — единственное обязательное по
// ОРД, диктует правила для остальных полей.
export const LegalEntityTypeSchema = z.enum(["ul", "ip", "fl", "ful", "ffl"]);
export type LegalEntityType = z.infer<typeof LegalEntityTypeSchema>;

// ИНН по типу: ЮЛ РФ → 10 цифр, ИП/физлицо → 12, иностранцы → без ИНН (null).
export function innLengthForType(type: LegalEntityType): 10 | 12 | null {
  if (type === "ul") return 10;
  if (type === "ip" || type === "fl") return 12;
  return null;
}

// Контрольная сумма ИНН (ФНС): 10 знаков — юрлицо, 12 — ИП/физлицо. Возвращает
// true только для формально корректного ИНН нужной длины.
export function isValidInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn)) return false;
  const d = [...inn].map(Number);
  const csum = (coefs: number[]) =>
    (coefs.reduce((s, c, i) => s + c * d[i]!, 0) % 11) % 10;
  if (d.length === 10) {
    return csum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  }
  const n11 = csum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  const n12 = csum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]);
  return n11 === d[10] && n12 === d[11];
}

// Части реквизитов, из которых собирается строка маркировки. Совпадает с
// колонками legal_entities (только те, что нужны для текста).
export type AdvertiserRequisites = {
  type?: LegalEntityType;
  orgForm?: string | null; // «ООО»/«АО»/«ИП»
  name?: string | null; // «Инстамарт Сервис» (без формы)
  city?: string | null;
  ogrn?: string | null;
  inn?: string | null;
};

// «Рекламодатель ООО «Инстамарт Сервис», Москва, ОГРН 1187746494980».
// Пустые части опускаем. ОГРН приоритетнее ИНН (как в требованиях маркировки);
// нет ни того ни другого — блок опускаем. Пусто на выходе, если нет названия.
export function advertiserLine(e: AdvertiserRequisites): string {
  const nm = e.name?.trim();
  if (!nm) return "";
  const titled = e.orgForm?.trim() ? `${e.orgForm.trim()} «${nm}»` : nm;
  const id = e.ogrn?.trim()
    ? `ОГРН ${e.ogrn.trim()}`
    : e.inn?.trim()
      ? `ИНН ${e.inn.trim()}`
      : null;
  const parts = [titled, e.city?.trim() || null, id].filter(Boolean);
  return `Рекламодатель ${parts.join(", ")}`;
}

// Итоговая строка маркировки: «Реклама. Рекламодатель …, ERID: …».
export function markingLine(e: AdvertiserRequisites, erid: string): string {
  const adv = advertiserLine(e);
  const tail = `ERID: ${erid}`;
  return adv ? `Реклама. ${adv}, ${tail}` : `Реклама. ${tail}`;
}

// Полное сообщение блогеру. «на картинку/видео» — слэшем: пост не всегда видео.
export function markingMessage(e: AdvertiserRequisites, erid: string): string {
  return `Маркировку наносим на картинку/видео небольшим, но заметным шрифтом:\n\n${markingLine(e, erid)}`;
}

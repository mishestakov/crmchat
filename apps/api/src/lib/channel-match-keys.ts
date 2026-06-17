// Кандидаты ключей матчинга канала (channels) с внешними реестрами по
// match_key — ЕДИНЫЙ источник правды «как канал отображается в match_key».
// Используется РКН-гейтом (rkn-registry) и гейтом «уже работает на платформе»
// (platform-active), чтобы правила нормализации не разъезжались между ними.
// Кандидатов до трёх: по username (без «@» в БД), по external_id (канонические
// id — YouTube UC…, Дзен hex, TG -100…) и по инвайт-хэшу из link (приватный
// TG / MAX). Параметризовано алиасом, т.к. встраивается и в drizzle-запросы
// (channels), и в raw-подзапросы с алиасом (ch в contact.channels).
// NULL-кандидаты в ANY безвредны (NULL-сравнение не матчится); '||' сам
// пропагирует NULL при NULL-username/external_id — CASE не нужен.
// Флаг 'i' у regexp_match — как /i в rknMatchKey (T.me/JoinChat/…).
export function channelMatchCandidatesSqlText(alias: string): string {
  return `ARRAY[
      ${alias}.platform || ':' || lower(${alias}.username),
      ${alias}.platform || ':' || lower(${alias}.external_id),
      CASE WHEN ${alias}.platform = 'telegram' AND ${alias}.link ~* 't\\.me/(joinchat/|\\+)'
        THEN 'telegram:+' || (regexp_match(${alias}.link, 't\\.me/(?:joinchat/|\\+)([A-Za-z0-9_-]+)', 'i'))[1] END,
      CASE WHEN ${alias}.platform = 'max' AND ${alias}.link ~* 'max\\.ru/join/'
        THEN 'max:+' || (regexp_match(${alias}.link, 'max\\.ru/join/([A-Za-z0-9_-]+)', 'i'))[1] END
    ]`;
}

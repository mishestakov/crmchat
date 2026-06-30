// Нормализация match_key канала — ЕДИНЫЙ источник правды правил матчинга для
// ОБЕИХ сторон сравнения через один билдер кандидатов:
//   * channels: `channelMatchCandidatesSqlText("ch")` — массив до 4 кандидатов
//     (username, external_id, инвайт-хэш TG/MAX). Используется РКН-гейтом и
//     бейджем «работает на платформе».
//   * platform_active_channels.match_key — тот же массив по голым колонкам
//     (`channelMatchCandidatesSqlText("")`), как generated-колонка text[].
// Матч симметричный: обе стороны держат ВСЕ свои отпечатки, пересекаем массивы
// (`&&`). Так канал, известный только по @username (external_id ещё NULL —
// id появляется лишь после открытия карточки), всё равно находится. NULL-
// элементы в `&&` безвредны; '||' сам пропагирует NULL при NULL-поле. Флаг 'i'
// у regexp_match — как /i в rknMatchKey (T.me/JoinChat/…). Хрупкие инвайт-
// regexp живут здесь же в одном месте — второго билдера, с которым можно
// разъехаться, больше нет.
//
// alias — ОБЯЗАТЕЛЕН (не дефолтим: "" даёт голые колонки, рискованные в JOIN —
// явный выбор на call-site). "" → голые имена (generated-колонка); "ch"/"channels"
// → `alias.col`. Строка байт-в-байт совпадает на обеих сторонах при одном alias.
export function channelMatchCandidatesSqlText(alias: string): string {
  const col = (name: string) => (alias ? `${alias}.${name}` : name);
  const link = col("link");
  const platform = col("platform");
  return `ARRAY[
      ${platform} || ':' || lower(${col("username")}),
      ${platform} || ':' || lower(${col("external_id")}),
      CASE WHEN ${platform} = 'telegram' AND ${link} ~* 't\\.me/(joinchat/|\\+)'
        THEN 'telegram:+' || (regexp_match(${link}, 't\\.me/(?:joinchat/|\\+)([A-Za-z0-9_-]+)', 'i'))[1] END,
      CASE WHEN ${platform} = 'max' AND ${link} ~* 'max\\.ru/join/'
        THEN 'max:+' || (regexp_match(${link}, 'max\\.ru/join/([A-Za-z0-9_-]+)', 'i'))[1] END
    ]`;
}

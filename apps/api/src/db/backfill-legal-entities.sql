-- Backfill юрлиц рекламодателей из старого free-text (tracks.properties) в
-- legal_entities. Одноразово на прод-хостах ПОСЛЕ db:push (создания таблицы).
-- Идемпотентно: NOT EXISTS-гейт + собственный id-ключ, повторный прогон no-op.
--
-- Маппинг: properties->>'inn' → inn; properties->>'legal_entity' (строка вида
-- «ООО «Кока-Кола»») кладём целиком в name (форму/город менеджер уточнит в
-- карточке клиента). type по умолчанию 'ul'. created_by берём с трека.
-- id = 12-hex (как shortId), валидный ОРД external_id.

INSERT INTO legal_entities
  (id, workspace_id, track_id, type, inn, name, created_by, created_at, updated_at)
SELECT
  substr(md5(random()::text || t.id), 1, 12),
  t.workspace_id,
  t.id,
  'ul',
  NULLIF(t.properties->>'inn', ''),
  COALESCE(NULLIF(t.properties->>'legal_entity', ''), t.name),
  t.created_by,
  now(),
  now()
FROM tracks t
WHERE (
    NULLIF(t.properties->>'inn', '') IS NOT NULL
    OR NULLIF(t.properties->>'legal_entity', '') IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM legal_entities le
    WHERE le.track_id = t.id AND le.contact_id IS NULL
  );

-- Прод-миграция: выпил legacy projects.messages + message_templates,
-- переход на opener (проектный) + dunning (на воркспейсе).
-- Применять РУКАМИ до деплоя кода (прод живёт с данными, аддитивно → дроп).
-- Порядок: бэкфилл (1-2) → NOT NULL (3) → дроп (4). Всё в одной транзакции.

BEGIN;

-- 1. Бэкфилл opener из messages[0] там, где он ещё пуст. На проде код уже
--    держал opener синхронным с messages[0], так что это страховка.
UPDATE projects
   SET opener = jsonb_build_object(
         'text', COALESCE(messages->0->>'text', ''),
         'warmText', messages->0->'warmText'
       )
 WHERE (opener IS NULL OR COALESCE(opener->>'text', '') = '')
   AND jsonb_array_length(messages) > 0;

-- 2. Бэкфилл workspace.dunning из messages[1..] (пинги + каданс) там, где
--    пиналка ещё не задана. Эвристика: берём цепочку самого свежего проекта
--    воркспейса с >1 сообщением (пиналка теперь одна на воркспейс; если у
--    проектов были разные — менеджер поправит в настройках воркспейса).
WITH src AS (
  SELECT DISTINCT ON (workspace_id) workspace_id, messages
    FROM projects
   WHERE jsonb_array_length(messages) > 1
   ORDER BY workspace_id, created_at DESC
)
UPDATE workspaces w
   SET dunning = jsonb_build_object(
         'pings', (
           SELECT jsonb_agg(jsonb_build_object('kind', 'text', 'text', m->>'text'))
             FROM jsonb_array_elements(src.messages) WITH ORDINALITY AS t(m, ord)
            WHERE ord > 1
         ),
         'intervals', (
           SELECT jsonb_agg(m->'delay')
             FROM jsonb_array_elements(src.messages) WITH ORDINALITY AS t(m, ord)
            WHERE ord > 1
         )
       )
  FROM src
 WHERE w.id = src.workspace_id
   AND w.dunning IS NULL;

-- 3. opener → NOT NULL DEFAULT '{"text":""}' (после бэкфилла).
ALTER TABLE projects ALTER COLUMN opener SET DEFAULT '{"text": ""}'::jsonb;
UPDATE projects SET opener = '{"text": ""}'::jsonb WHERE opener IS NULL;
ALTER TABLE projects ALTER COLUMN opener SET NOT NULL;

-- 4. dunning → NOT NULL DEFAULT пустая (симметрично opener: nullable не несёт
--    инфы — «не настроена» = «пустая серия»). Оставшиеся NULL (воркспейсы без
--    multi-message проекта в шаге 2) добиваем пустыми.
ALTER TABLE workspaces ALTER COLUMN dunning SET DEFAULT '{"pings": [], "intervals": []}'::jsonb;
UPDATE workspaces SET dunning = '{"pings": [], "intervals": []}'::jsonb WHERE dunning IS NULL;
ALTER TABLE workspaces ALTER COLUMN dunning SET NOT NULL;

-- 5. Дроп легаси (деструктивно — подтверждено: ценных данных нет).
ALTER TABLE projects DROP COLUMN messages;
DROP TABLE message_templates;

COMMIT;

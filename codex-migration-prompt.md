Контекст: dev-сервис crmchat (Node+Hono+Drizzle+Postgres). Боевая БД на этой VM
живёт с реальными данными — НИКАКОГО drizzle-kit push, НИКАКОГО truncate,
НИКАКОГО --force. Только аддитивный, идемпотентный SQL руками через psql,
с проверкой дублей перед добавлением уникальности.

Схема в коде (apps/api/src/db/schema.ts) ушла вперёд относительно БД на два
объекта. Нужно довести БД до схемы безопасно. DATABASE_URL бери из
apps/api/.env (или из окружения сервиса).

Сделай строго по шагам и в конце отчитайся выводом каждого шага:

ШАГ 1. Создай недостающую таблицу (полностью безопасно, новая пустая):
  CREATE TABLE IF NOT EXISTS platform_active_channels (
    tg_chat_id text PRIMARY KEY,
    source     text NOT NULL,
    match_key  text,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS platform_active_channels_match_key_idx
    ON platform_active_channels (match_key);

ШАГ 2. ПРОВЕРКА дублей перед уникальным констрейнтом — это гейт:
  SELECT workspace_id, platform, external_user_id, count(*) AS n
  FROM outreach_accounts
  GROUP BY 1,2,3
  HAVING count(*) > 1;
  -> Если вернулись строки: НЕ продолжай, выведи их и останови работу
     (это требует ручного решения, какой дубль убрать). Если строк нет —
     переходи к ШАГ 3.

ШАГ 3. Добавь UNIQUE идемпотентно (только если ШАГ 2 пустой):
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'outreach_accounts_workspace_external_unique'
    ) THEN
      ALTER TABLE outreach_accounts
        ADD CONSTRAINT outreach_accounts_workspace_external_unique
        UNIQUE (workspace_id, platform, external_user_id);
    END IF;
  END $$;

ШАГ 4. Проверь, что других расхождений нет: перезапусти api (pnpm dev или как
  запускается сервис) и убедись, что в логах НЕТ ошибок вида
  'relation "..." does not exist' (код 42P01) при открытии канбана/лидов.
  Если всплыли ещё недостающие relation — НЕ создавай их наугад, выпиши
  список имён и верни мне, я сверю со схемой.

Отчитайся: что вывел ШАГ 2 (дубли/нет), создан ли констрейнт, чистый ли старт
api в ШАГ 4.

═══════════════════════════════════════════════════════════════════════════
ОБНОВЛЕНИЕ bd-autodogon: опенер + пиналка на воркспейс + котики
═══════════════════════════════════════════════════════════════════════════

Контекст изменений. Плоская лента projects.messages разнесена:
  • projects.opener  — первое касание, ПРОЕКТНЫЙ (свой питч у кампании).
  • workspaces.dunning — пиналка (фразы+котики+ритм), ОДНА на воркспейс.
  • scheduled_messages получил dunning_round + снимок стикер-пинга (котика).
Всё аддитивно. projects.messages НЕ дропаем — он ещё нужен как fallback (worker
на пустом workspaces.dunning конвертит пиналку из messages на лету) и уйдёт
отдельным поздним шагом (DROP messages). На этом проде колонки projects.dunning,
скорее всего, НЕТ (промежуточный B1-накат сюда не делали) — DROP IF EXISTS
безопасен.

ШАГ 5. Аддитивные колонки (идемпотентно, безопасно — новые/nullable):
  ALTER TABLE projects ADD COLUMN IF NOT EXISTS opener jsonb;
  ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS dunning jsonb;
  ALTER TABLE scheduled_messages
    ADD COLUMN IF NOT EXISTS dunning_round integer NOT NULL DEFAULT 0;
  ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS sticker_set_name text;
  ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS sticker_unique_id text;

ШАГ 6. Бэкфилл опенера из первого сообщения цепочки (идемпотентно — только там,
  где opener ещё пуст, и есть messages):
  UPDATE projects
  SET opener = jsonb_build_object(
        'text',     messages->0->>'text',
        'warmText', messages->0->>'warmText'
      )
  WHERE opener IS NULL
    AND jsonb_array_length(messages) > 0;

ШАГ 7. workspaces.dunning НЕ бэкфиллим SQL'ом — оставляем NULL. Worker/scheduler
  на NULL берёт fallback из projects.messages (тексты-пинги + интервалы), так
  холодный догон продолжает работать. Котиков и итоговую пиналку менеджер
  настроит в UI: страница «Пиналка» воркспейса (меню → Пиналка). Это сознательно
  — пиналка теперь общая на воркспейс, её настраивают один раз руками.

ШАГ 8. Снять старую колонку, ЕСЛИ она была заведена (на этом проде её, скорее
  всего, нет — IF EXISTS не упадёт):
  ALTER TABLE projects DROP COLUMN IF EXISTS dunning;
  -- projects.messages НЕ ТРОГАЕМ (нужен для fallback + поздний DROP messages).

ШАГ 9. Перезапусти api. Проверь логи на отсутствие ошибок колонок (код 42703
  undefined_column) при открытии: проекта (Настройки → «Первое касание»
  показывает опенер) и страницы «Пиналка» воркспейса. Если всплыли ещё
  недостающие колонки/relation — НЕ создавай наугад, выпиши имена и верни мне.

Отчитайся по ШАГ 5–9: какие ALTER применились, сколько строк обновил бэкфилл
ШАГ 6, была ли колонка projects.dunning (DROP сработал или «не существует»),
чистый ли старт api.

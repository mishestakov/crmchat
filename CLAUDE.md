# crmchat

Internal Yandex CRM (greenfield, MVP). Stack: Bun + Hono + Drizzle + Postgres / React + Vite + TanStack + Tailwind / pnpm workspaces + Turborepo.

## Где смотреть

- `specs/` — целевое поведение (US-1…US-30, architecture, auth, data-model, permissions, api-contracts).
- `DECISIONS.md` — лог осознанных отклонений от оригинала (`app.crmchat.ai`).
- `tools/capture/` — legacy reverse-engineering pipeline. Вне pnpm-workspace, не трогаем.

## Bootstrap

```bash
pnpm install
cp .env.example .env
pnpm setup    # docker compose up -d --wait + db:push + db:seed
pnpm dev      # turbo: api:3000 + web:5173
```

## Правила разработки в MVP-режиме

Сейчас пишем **функционально-полный slice с минимальным UI** — все CRUD-сценарии донор-сервиса работают, оформление страшное. Полировка UX — отдельным проходом потом. Чтобы UI-pass был «переписать JSX», а не «переписать всё»:

1. **Бизнес-логика — в `queryFn`/`mutationFn`, не в компонентах.** Кнопка вызывает `mutate()`, не знает про POST/invalidate.
2. **Data shape — сразу финальный.** Поля, которые UI пока не рендерит, остаются в API/типах. Не урезаем под «текущий UI».
3. **URL-структура — сразу финальная.** Маршруты не переименовываем при UX-проходе.
4. **Не выносим компоненты в `components/` пока их 1 шт.** Inline JSX + Tailwind — норма для MVP. Выносим на третьем повторе.
5. **Никаких "TODO: edit later" в UI — кнопка либо работает, либо её нет.** Зомби-контролов не оставляем.
6. **Кнопка «Сохранить» показывается только при наличии unsaved-изменений.** В формах с `useState`-черновиком сравниваем draft с сервер-данными (`JSON.stringify`-equal по полному shape) и скрываем кнопку, если diff'а нет. Никаких всегда-зелёных кнопок, мигающих после успешного save.

## Дополнительно

- Auth: пока mock-session (см. `apps/api/src/routes/auth.ts`, dev-only `_dev/login` под `NODE_ENV !== production`). Боевой Яндекс OAuth втыкается через тот же `createSession` helper — точка входа `apps/api/src/lib/sessions.ts`.
- Tenancy: workspace-scoped ручки под `assertMember` middleware. Сейчас правило — `workspaces.createdBy = userId`; заменится на `workspace_members` join вместе с auth-ролями.
- Single source of truth: Zod-схемы в `@repo/core` → валидация в API + OpenAPI doc + typed client (`@repo/api-client`, генерится `pnpm -F @repo/api-client generate` после изменений в API).
- Drizzle: `db:push` в dev (без миграционных файлов). Перед prod-деплоем — переключиться на `generate` + `migrate`.

# Architecture

Восстановленная картина стека и потоков данных. Источники: `code-inventory.json`, captured RPC в `tools/capture/processed/`, `api-contract.generated.json`, названия пакетов в imports (`@repo/core`, `@repo/ui` и т.п.).

---

## 1. High-level картина

```
┌────────────────────────────────────────────────────────────────────────┐
│                       Browser / TG Mini-App                            │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  React SPA + TanStack Router                                 │      │
│  │  state: TanStack Query (serverState) + Firestore subscribe   │      │
│  │  forms: react-form + Zod schemas                             │      │
│  │  i18n:  i18next (bundled `locales/chunks/*.js`)              │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────────┬────────────────────┬────────────────────┬───────────────┘
               │                    │                    │
      [tRPC batched POST]    [oRPC REST]         [Firestore SDK]
               │                    │                    │
┌──────────────▼────────────────────▼────────────────────▼───────────────┐
│           api.crmchat.ai        (backend, Node)                        │
│  ┌──────────────────────┐  ┌──────────────────────┐                    │
│  │ tRPC v11 procedures  │  │ oRPC generated REST  │                    │
│  │ workspace.*          │  │ workspaces.*         │                    │
│  │ contact.*            │  │ outreach.sequences.* │                    │
│  │ telegram.*           │  │ ...                  │                    │
│  └──────────┬───────────┘  └──────────┬───────────┘                    │
│             │                         │                                │
│             ▼                         ▼                                │
│  ┌──────────────────────────────────────────────────────┐              │
│  │         Firebase Admin SDK (same GCP project)        │              │
│  └──────────────────────────────────────────────────────┘              │
└────────────────┬───────────────────────────────┬───────────────────────┘
                 │                               │
         ┌───────▼────────┐              ┌───────▼────────┐
         │  Firestore     │              │ Firebase       │
         │  (prod data,   │              │ Storage        │
         │   real-time    │              │ (files, avatars)│
         │   subscribe)   │              │                │
         └───────┬────────┘              └────────────────┘
                 │
                 ▼
         ┌──────────────────────────────────────────┐
         │  Background (Cloud Functions / workers)  │
         │  – outreach scheduler                    │
         │  – TG session drivers (MTProto)          │
         │  – invite TTL expirator                  │
         └──────────────────────────────────────────┘
```

---

## 2. API-слои — зачем **два**

В `code-inventory.json` видны два параллельных набора ручек:

| Namespace | Протокол | Пример | Клиент дёргает |
|---|---|---|---|
| `workspace.*`, `contact.*`, `telegram.*`, `outreach.*` (частично) | **tRPC v11** batched POST | `POST https://api.crmchat.ai/trpc/workspace.createWorkspace?batch=1` | TanStack Query hooks генерируются из tRPC router'а |
| `workspaces.*`, `outreach.sequences.*`, `outreach.lists.*` (частично) | **oRPC** generated REST | `POST /api/workspaces.getMembers` | Тот же клиент, но с codegen из `api-contract.generated.json` |

Это **не legacy**, это сознательное разделение:

- **tRPC** = внутренние мутации UI → backend. Type-safe end-to-end внутри монорепы, не стабильный контракт. Timestamp отдаётся как `{_seconds, _nanoseconds}` (Firestore native).
- **oRPC** = **публично задокументированный** контракт, описанный в `api-contract.generated.json`. Сюда попадают ручки, которые могут вызывать сторонние (integrations, Zapier, будущее публичное API). Timestamp — ISO-строка.

Свидетельство «это не дубль, а два разных набора»: имена различаются явно (`workspace.createWorkspace` vs `workspaces.getMembers` — множественное число у oRPC). Пересечений по семантике почти нет — см. `specs/api-contracts.md`.

**Рекомендация для реимплементации**: начать с одного tRPC. oRPC-слой поднимать только когда появляются реальные внешние потребители.

---

## 3. Real-time данных — Firestore subscribe, не tRPC

Принципиальное архитектурное решение: **чтение** основных коллекций (contacts, messages, activities, sequences leads) идёт напрямую клиентом в Firestore через SDK, а tRPC/oRPC — только для **мутаций** и для тех read'ов, которые нужно обогатить серверной логикой (например, `workspaces.getMembers` джойнит user profile из другой коллекции).

Это объясняет:
- Почему в coverage-check 27 Firestore-функций — каждая требует decisions в `scope.json`.
- Почему US-10 (чат), US-11 (контакты), US-14 (карточка) показывают «RPC на бутстрэпе — вспомогательные, а основной канал — Firestore subscription».
- Почему US-7/8 (create/edit property) не имеют tRPC create/update ручек — это прямой Firestore write.

**Impl-следствие**: Firestore security rules — **первая линия авторизации**, не опциональная. Реимплементация без rules = утечка всех данных между воркспейсами. См. `permissions.md`.

---

## 4. Монорепо (предположение)

Видимые пакеты (из имён и импортов):
- `@repo/core` — shared types (`WorkspaceRoleSchema`, etc.), Zod-схемы, enum'ы.
- `@repo/ui` — дизайн-система (кнопки, формы).
- `@repo/api-contract` — `api-contract.generated.json` + codegen.
- `web` (SPA) — основной фронт.
- `api` — tRPC/oRPC backend.
- `functions` — Cloud Functions (scheduler, triggers).

⚠️ **OQ-Arch-1**: подтвердить структуру workspace'ов монорепы (pnpm / turborepo / nx). Ни на чём не ловили.

---

## 5. Frontend stack

| Слой | Выбор | Свидетельство |
|---|---|---|
| Фреймворк | **React** (SPA, CSR) | `index.html` минимален, hydration признаков нет |
| Роутер | **TanStack Router** (file-based) | `code-inventory.routes` содержит строки вида `ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport` — это ровно имена, которые генерирует TanStack Router plugin |
| Server state | **TanStack Query** | стандартный партнёр TanStack Router + tRPC v11 |
| Формы | **react-form (`@tanstack/react-form`)** + `revalidateLogic()` | из имён ошибок в UI (`shouldNotEmpty`) и паттерна captured форм |
| Валидация | **Zod** | пакет `@repo/core` экспортирует schemas |
| i18n | **i18next**, bundled | `locales/chunks/*.js` = заранее скомпилированные chunks, не fetch'ится |
| Стили | **Tailwind** + Material-esque компоненты | (OQ, по HTML-снапшотам классы похожи на Tailwind; proof можно найти в bundle) |
| Telegram Mini-App | `@twa-dev/sdk` или native | см. `auth.md` |

Auth-ветки: web (Firebase Auth + custom token) и TG Mini-App (initData → custom token). Обе приходят к одному Firebase Auth user.

---

## 6. Backend stack

| Слой | Выбор | Свидетельство |
|---|---|---|
| Хост | **api.crmchat.ai** (отдельный origin от фронта — видим CORS preflight `OPTIONS` в каждом RPC) | captured headers |
| Runtime | Node (tRPC v11) | ― |
| Storage | **Firestore** + **Firebase Storage** + **Firebase Auth** | §1 data-model.md |
| Прямой MTProto | `gramjs`-like библиотека на backend'е — session keys ездят туда-сюда через tRPC | `telegram.account.getAccountConnectionData` отдаёт `{ session.keys, session.hashes }` |
| Scheduler | Cloud Functions + Cloud Scheduler (предположение) | `rescheduleSequences` эффект — точно backend, не клиент |
| Прокси (для TG-аккаунтов) | Свой пул прокси по 10 странам | `proxy.getCountries` |

⚠️ **OQ-Arch-2**: используется ли Cloud Functions или это self-hosted Node? Подсказка: admin SA `firebase-adminsdk-bntbj@...` в signed URL'ах — значит, как минимум часть backend'а имеет Admin SDK credentials.

---

## 7. Request flow — пример создания воркспейса

1. Юзер в `/` (ProtectedIndex) или `/settings/workspace/new`.
2. Форма submit → `useMutation` из tRPC-клиента → `POST /trpc/workspace.createWorkspace?batch=1`.
   - Payload: `{"0":{"name":"test5","organizationId":"HOg..."}}`.
   - Headers: `Authorization: Bearer <firebase-id-token>` (OQ, в capture не видим — CDP не перехватывает request headers, но это стандарт).
3. Backend:
   - Валидирует id-token через `admin.auth().verifyIdToken()`.
   - Создаёт doc в `workspaces/{autoId}` + membership в `workspaces/{id}/members/{uid}` с `role: admin`.
   - Возвращает doc.
4. Клиент:
   - TanStack Query инвалидирует связанные queries (`workspaces.getMembers`, sidebar picker).
   - Router `replace` на `/w/{newId}/settings/workspace`.
   - Firestore-подписки destination-страницы стартуют (получают members, pending invites из **Firestore напрямую**, не tRPC).

---

## 8. Why TanStack Router (file-based)

Свидетельство — `code-inventory.routes` содержит очень длинные generated имена (`ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport`). Это **unique signature** TanStack Router file-based конвенции:
- `_protected` layout → prefix `Protected`.
- `/w/$workspaceId/settings/workspace/invite` → `WWorkspaceIdSettingsWorkspaceInvite` (camelCase path segments).
- `RouteImport` — generated binding type.

Альтернативы (React Router, Next.js App Router) дают совсем другие signatures. Это фактически neon-sign «TanStack Router».

---

## 9. Почему Firestore для real-time

Альтернативы — свой WebSocket / SSE / Supabase Realtime. Firestore выбран, потому что:
- Chat-heavy продукт — Firestore отлично индексирует «messages for chat X, last N, order by ts» с subscriptions.
- Outreach lead-lists — тяжёлые коллекции с частыми обновлениями статусов.
- Нет нужды держать свои WS-серверы.

**Цена**: security rules становятся критичными, Firestore pricing растёт линейно с read'ами (каждая подписка платная), schema-миграции дороже (нет native alter table).

---

## 10. Observability

Видимое:
- **PostHog** — токен и `productId: "crmchat.ai"` зашиты в каждый integration-ответ (Cello, Google Calendar, etc.). Значит, PostHog backend-side.
- **Sentry / crash reporting** — ⚠️ **OQ-Arch-3**, в capture не видели.
- **Логирование** — Cloud Logging стандартно для Firebase, но не подтверждено.

---

## 11. Deployment / environments

⚠️ **OQ-Arch-4**: `isSandbox: false` в каждом integration-ответе намекает, что существует `isSandbox: true` режим — вероятно, dev/staging. Детали (URL, отдельный Firebase project?) — не захвачены.

---

## 12. Что обязательно воспроизвести для работающего клона

1. **Firebase project** — Auth + Firestore + Storage (один проект, как в оригинале).
2. **Firestore security rules** — без них всё небезопасно. Нужен rules-reverse-engineering отдельной стори.
3. **tRPC backend** — минимум 50 captured procedures (см. `specs/api-contracts.md`).
4. **MTProto clients** — отдельный subsystem для outreach-аккаунтов и personal sync. Ядро сложности всего продукта.
5. **Scheduler** — Cloud Function по cron'у, пересчитывающая sequence schedule.
6. **Storage signed-URL flow** — для CSV upload и attachments.
7. **Proxy pool** — 10 стран, mapping country → proxy endpoint. Либо свой пул, либо интеграция с Bright Data / аналог.

---

## 13. Что можно без потери функциональности выкинуть

- **oRPC слой** — до появления внешних потребителей; всё живёт в tRPC.
- **Cello integration** — viral/referral, не core.
- **Google Calendar integration** — nice-to-have для reminders.
- **PostHog** — замените на ваш favorite analytics.

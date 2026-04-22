# Permissions

Модель ролей и авторизации. Источники: `WorkspaceRoleSchema` в `@repo/core` (declared), captured RPC inputs/responses, i18n-ключи ролей.

---

## 1. Роли воркспейса

Три роли, видимые в capture и UI:

| key | UI label (ru) | Источник |
|---|---|---|
| `admin` | **Админ** | `web.role.admin` + `inviteWorkspaceMember` captured с `role: "admin"` |
| `member` | **Участник** | `web.role.member` + дефолт в invite-форме (US-2) |
| `chatter` | **Чаттер** | `web.role.chatter` + captured `inviteWorkspaceMember({role: "chatter"})` |

⚠️ **OQ-Perm-1**: есть ли четвёртая роль — `owner`? В user-stories.md упомянуто «владелец воркспейса», но в `WorkspaceRoleSchema` видим только эти три. Вероятно, `createdBy` у документа воркспейса играет роль owner без отдельного enum-значения. Нужен взгляд в `@repo/core/types`.

⚠️ **OQ-Perm-2**: есть ли роль `observer` / `viewer` (read-only) — в user-stories.md старом варианте упоминалась, но не подтверждена capture.

---

## 2. Матрица возможностей (ожидаемая)

Выведена из UI-поведения (US-2, US-4) и семантики ручек. **Не подтверждено серверной проверкой** — нужен негативный capture.

### Условные обозначения
- ✅ можно
- ❌ нельзя
- 🚫 кнопки нет в UI / дизейблится
- `self` — применительно только к себе
- `*` — применительно к другим

| Возможность | `admin` | `member` | `chatter` | Creator |
|---|:-:|:-:|:-:|:-:|
| **Workspace** | | | | |
| Создать новый воркспейс | ✅ | ✅ | ✅ | n/a |
| Переименовать текущий | ✅ | ⚠️ | ⚠️ | ✅ |
| Удалить воркспейс | ⚠️ | ❌ | ❌ | ⚠️ |
| Привязать организацию | ⚠️ | ❌ | ❌ | ⚠️ |
| **Members (US-2, US-4)** | | | | |
| Пригласить нового | ✅ | ⚠️ | ❌ | ✅ |
| Сменить роль другого | ✅ | ❌ | ❌ | ✅ |
| Сменить свою роль | 🚫 | 🚫 | 🚫 | 🚫 (UI: «Вы не можете изменить свою собственную роль») |
| Удалить другого | ✅ | ⚠️ | ❌ | ✅ |
| Покинуть воркспейс (self) | ✅ | ✅ | ✅ | ⚠️ (OQ: может ли creator покинуть, если он единственный admin?) |
| **Properties (US-6-US-8)** | | | | |
| Смотреть список | ✅ | ✅ | ✅ | |
| Создавать/редактировать поля | ⚠️ | ⚠️ | ❌ | |
| Удалить системное поле | ❌ | ❌ | ❌ | |
| **Contacts (US-11-US-16)** | | | | |
| Читать контакты | ✅ | ✅ | ✅ | |
| Создавать/редактировать | ✅ | ✅ | ✅? (OQ) | |
| Массовое удаление | ✅ | ⚠️ | ❌ (OQ) | |
| **Chat (US-10)** | | | | |
| Видеть свои чаты | ✅ | ✅ | ✅ | |
| Видеть чужие чаты | ⚠️ см. §3 | | | |
| **Outreach (US-17-US-27)** | | | | |
| Подключить TG-аккаунт | ✅ | ⚠️ | ❌ (OQ) | |
| Настраивать аккаунт | ✅ | ⚠️ | ❌ | |
| Создать кампанию | ✅ | ✅ | ❌ (OQ) | |
| Start/pause кампанию | ✅ | ⚠️ | ❌ | |
| Удалить кампанию | ✅ | ❌ | ❌ | |
| Переместить аккаунты между WS | ✅ | ❌ | ❌ | |
| **Settings** | | | | |
| Глобальное расписание | ✅ | ⚠️ | ❌ | |
| Смена языка (self) | ✅ | ✅ | ✅ | |
| Удалить свой аккаунт | ✅ | ✅ | ✅ | |

⚠️ — предположение, не подтверждено. Для критичных решений нужен **негативный capture**: войти под `chatter`, попробовать invite → зафиксировать `FORBIDDEN`-ответ.

---

## 3. Privacy между членами команды (критично)

В US-2 над формой приглашения показан warning:

> ⚠️ «Члены команды в этом рабочем пространстве увидят ваши чаты Telegram»

Это явное UI-предупреждение о том, что **данные чатов расшариваются внутри воркспейса**. Следствия:
- `chatter`, `member`, `admin` — все видят переписку всех TG-аккаунтов, подключённых к воркспейсу.
- «Приватность на уровне чата» отсутствует; granular ACL только на уровне воркспейса.
- Это же означает: **модель изоляции — workspace, не user**. Весь data-slicing в Firestore rules должен быть по `workspaceId`, а не по `userId`.

---

## 4. Workspace isolation

Каждый документ основных коллекций содержит `workspaceId`. Это делает workspace **обязательным security boundary**.

### Что это значит для Firestore rules (предположение)

```javascript
// workspaces/{wsId}
match /workspaces/{wsId} {
  allow read: if isMember(wsId);
  allow update: if isAdmin(wsId);
  allow delete: if isAdmin(wsId);
}

// workspaces/{wsId}/members/{uid}
match /workspaces/{wsId}/members/{uid} {
  allow read: if isMember(wsId);
  allow write: if isAdmin(wsId);
}

// contacts, sequences, etc.
match /contacts/{doc} {
  allow read, write: if isMember(resource.data.workspaceId);
}

function isMember(wsId) {
  return exists(/databases/$(database)/documents/workspaces/$(wsId)/members/$(request.auth.uid));
}
function isAdmin(wsId) {
  return get(/databases/$(database)/documents/workspaces/$(wsId)/members/$(request.auth.uid)).data.role == "admin";
}
```

⚠️ **OQ-Perm-3**: это гипотеза. Без реальных `firestore.rules` любая реимплементация — лотерея. Нужно либо reverse-engineer'ить через негативные test'ы (пробовать читать чужой workspace), либо запросить у команды.

---

## 5. Server-side проверки (tRPC / oRPC)

Каждая мутация принимает `workspaceId` в input. Ожидаемо, на сервере первой строкой идёт проверка `assertMember(ctx.uid, input.workspaceId)`, а для admin-actions — `assertRole(ctx.uid, input.workspaceId, "admin")`.

Свидетельство косвенное: в captured `changeWorkspaceMemberRole.input` `workspaceId` передаётся явно — сервер не берёт его из сессии. Значит, единая middleware проверяет членство на каждом запросе.

⚠️ **OQ-Perm-4**: точные коды ошибок FORBIDDEN. Нужен негативный capture.

---

## 6. Creator / Owner — неявная роль

В `createWorkspace.response` видно поле `createdBy: "<uid>"`. В captured enum'ах нет `owner`. Логично предположить:
- `createdBy` — неявный owner.
- Всегда получает `role: "admin"` в collection `members/{uid}`.
- Может иметь доп. права, не выражаемые через enum (например, удалить workspace — action не виден вообще в UI).

Для UI достаточно двух состояний: «я creator vs нет», остальное производно от role.

---

## 7. Telegram-аккаунты и роли

Outreach-аккаунты (US-17, US-18) подключаются на уровне workspace'а, а не user'а. Значит:
- Любой admin/member workspace'а может использовать аккаунт в своей кампании (см. US-23).
- Удалить аккаунт может, вероятно, только admin (или тот, кто его подключил — OQ).
- Переместить аккаунты между workspace'ами (US-19) — операция между двумя security boundaries, требует **обоих** членств и admin-роли в target'е.

---

## 8. Аутентификация запросов

Канал аутентификации — Firebase Auth id-token в `Authorization: Bearer` header'е:
- **TG Mini-App**: initData → `telegram.authenticateByInitData` → custom token → `signInWithCustomToken` → id-token.
- **Browser**: Firestore `authSessions/{id}` → custom token → тот же id-token.

См. `auth.md` для деталей.

---

## 9. Что обязательно воспроизвести

1. **WorkspaceRoleSchema** — enum из 3 значений, в `@repo/core` (shared между front и back).
2. **Firestore security rules** — наибольший риск при реимплементации, см. §4.
3. **Server middleware** — на каждой tRPC/oRPC ручке `assertMember(ctx.uid, workspaceId)` + где нужно — `assertRole == "admin"`.
4. **UI gate'ы** — дизейблить кнопки по роли клиент-сайд (UX), но никогда не полагаться только на них.

---

## 10. Priority OQs для ближайшего capture

- **OQ-Perm-1**: подтвердить/опровергнуть `owner` / `observer` в `WorkspaceRoleSchema`.
- **OQ-Perm-4**: собрать негативные ответы для критичных actions (invite от `chatter`, role-change от `member`, delete workspace от `admin`).
- **OQ-Perm-3**: получить реальные Firestore rules или reverse-engineer через нелегальные read/write.

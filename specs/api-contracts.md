# API contracts

Справочник REST-ручек (`/v1/*`). Единый контракт обслуживает UI и внешние интеграции; аутентификация — Firebase id-token (UI) или API-key (интеграции).

Формы данных выведены из реальных вызовов оригинального сервиса.

> Сгенерировано из `tools/capture/processed/rpc/*`. Не редактируй вручную — правь генератор `tools/capture/src/contracts-extract.ts`. Источник: 39 ручек, 666 зафиксированных вызовов.

## Обозначения
- `required` — поле присутствует во всех N вызовах.
- `optional (seen X/N)` — поле есть не везде. При N=1 optional не детектируется (все поля показаны как required — «assumed»).
- Вложенные объекты и массивы показаны as-is из одного свежего примера, не мёржатся.
- В реимплементации timestamp'ы сериализуются как ISO-8601 строки; в captured-примерах встречается формат `{_seconds, _nanoseconds}` — особенность перехваченного транспорта, не целевой контракт.

## activity.scheduleCalendarEventIfPossible

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 5
- **Used by**: US-10, US-15

### Input
Required:
- `activityId: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "activityId": "iU75pGlvXYs8oWMO8oXR"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## cello.getInitOptions

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 250
- **Used by**: _(нет stories, см. scope.json/rpc_decisions)_

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 245/250)`
- `firstName: string  (seen 245/250)`
- `isSandbox: boolean  (seen 245/250)`
- `productId: string  (seen 245/250)`
- `status: string  (seen 4/250)`
- `token: string  (seen 245/250)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3MzY3MDd9.351ZcCVxzz5s6l5y2jH9zu9bWtEOzXcaS4ICcCOCg8B4fEckE92aFdqkakT7wZ0GzFBhO16IiLR7EXPNAx1a6Q",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## contact.bulkUpdate

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-11, US-16

### Input
Required:
- `contactIds: array`
- `updateData: object`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "contactIds": [
    "MZRLawri2tZqf8yYybel",
    "1yZ1b66h5o4BGs2CCFLU"
  ],
  "updateData": {
    "custom.80Z2YCO3vXMddONFPbcPX": "ппп"
  }
}
```

### Output
Required:
- `operationId: string`

Sample:
```json
{
  "operationId": "eMDU7iSbNAEEFv4HXFK_j"
}
```

## contact.deleteContacts

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 2
- **Used by**: US-11, US-16

### Input
Required:
- `contactIds: array`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "contactIds": [
    "eyp0WOVBdOtY8DHkdLl3"
  ]
}
```

### Output
_пустой_

## googleCalendar.getAccount

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 15
- **Used by**: _(нет stories, см. scope.json/rpc_decisions)_

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 12/15)`
- `firstName: string  (seen 12/15)`
- `isSandbox: boolean  (seen 12/15)`
- `productId: string  (seen 12/15)`
- `token: string  (seen 12/15)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3MzY5OTB9.J6Z8soHu57vVNViv8oCsAtzUhnAI8wvMLPByNdwwKfryVqLFiObCIwC-TlLNOoEb5hB194kHYqL6NzVGK-fb0g",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## outreach.generateUploadSignedUrl

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 3
- **Used by**: US-21, US-22

### Input
Required:
- `fileName: string`
- `mimeType: string`
- `public: boolean`
- `type: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "4L1YDj39qRZJ23ACcD12",
  "fileName": "dzen_publications_export.json",
  "mimeType": "application/json",
  "type": "media",
  "public": true
}
```

### Output
Required:
- `filePath: string`
- `fileUrl: string`
- `headers: object`
- `signedUrl: string`

Sample:
```json
{
  "signedUrl": "https://storage.googleapis.com/hints-crm.appspot.com/w/4L1YDj39qRZJ23ACcD12/outreach/media/Z1h7rMo7L4DRjs2ORA4YB.json?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=firebase-adminsdk-bntbj%40hints-crm.iam.gserviceaccount.com%2F20260421%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20260421T133155Z&X-Goog-Expires=1800&X-Goog-SignedHeaders=content-type%3Bhost%3Bx-goog-meta-firebasestoragedownloadtokens&X-Goog-Signature=1525e3362fb4c2ab84134d91ce84b39dd6d2f10cf3a913e9ffdba8f8f3193dd60db43dffaa77b9f7ca347d1b67740b1da03ec8ec014f6d5c5af04146c78719e22da08a5759f1522cf5b982cecc226cfa6ac35dc68340b4cc9d4d57de025c4586e5635640ed0187c03bbc767f1b1e343c42cefb03699da98bb41017a3b425b66d6f400c0ed067d15d8d94e47f8d4361191c888ab61f961d9ad188193989df9c4133a92c70ff154ff3c406e0506fdaf17a404f37fe1c9409441ef02948d221a861ca4f36180c8d2bed3b27c0f16cd07ddef41e3a2df68f4baffa96c4b402c163d530cc48f4348be8c14cb1e610bd6f49e03138139162e5c1eda7dbe8f87d0fc332",
  "filePath": "w/4L1YDj39qRZJ23ACcD12/outreach/media/Z1h7rMo7L4DRjs2ORA4YB.json",
  "fileUrl": "https://firebasestorage.googleapis.com/v0/b/hints-crm.appspot.com/o/w%2F4L1YDj39qRZJ23ACcD12%2Foutreach%2Fmedia%2FZ1h7rMo7L4DRjs2ORA4YB.json?alt=media&token=e0f72bec-0f2c-4716-9c1e-c9349c8e5a09",
  "headers": {
    "x-goog-meta-firebaseStorageDownloadTokens": "e0f72bec-0f2c-4716-9c1e-c9349c8e5a09"
  }
}
```

## outreach.getLeads

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 19
- **Used by**: US-25

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 9/19)`
- `firstName: string  (seen 9/19)`
- `isSandbox: boolean  (seen 9/19)`
- `leads: array  (seen 10/19)`
- `list: object  (seen 10/19)`
- `productId: string  (seen 9/19)`
- `requireDuplicateResolution: boolean  (seen 10/19)`
- `sequenceId: string  (seen 10/19)`
- `token: string  (seen 9/19)`
- `workspaceId: string  (seen 10/19)`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "sequenceId": "GADmh7QJIyXjql37nfRq",
  "list": {
    "id": "zsWrWrF3NF8hHFmsNyHG",
    "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
    "properties": [
      ""
    ]
  },
  "leads": [
    {
      "lead": {
        "id": "AfgGV5HHMzHbMH5zKLUS",
        "type": "user",
        "username": "mikeshestakov_dev",
        "properties": {}
      },
      "messages": {}
    },
    {
      "lead": {
        "id": "CCEuyaDQq3dShrAPtnec",
        "type": "user",
        "username": "mike1936",
        "properties": {}
      },
      "messages": {}
    },
    {
      "lead": {
        "id": "WM1cP14HWsoCm5OQaBSw",
        "type": "user",
        "username": "mikeshestakov",
        "properties": {}
      },
      "messages": {}
    }
  ],
  "requireDuplicateResolution": false
}
```

## outreach.getSequenceAnalytics

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 7
- **Used by**: US-26

### Input
_пустой / в URL_

### Output
Required:
- `dataPoints: array`
- `grouping: string`

Sample:
```json
{
  "dataPoints": [
    {
      "date": "2026-04-14",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-15",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-16",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-17",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-18",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-19",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-20",
      "sent": 0,
      "read": 0,
      "replied": 0
    },
    {
      "date": "2026-04-21",
      "sent": 0,
      "read": 0,
      "replied": 0
    }
  ],
  "grouping": "day"
}
```

## outreach.getSequenceStats

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 19
- **Used by**: US-26

### Input
_пустой / в URL_

### Output
Required:
- `email: string`
- `firstName: string`
- `isSandbox: boolean`
- `productId: string`
- `token: string`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3MzczOTV9.08N3dlwPGXfg-myrLrrFVpjfux7y0gYHV9vVTNRghWCw1oL28C8l9Ot6rXKuQwprwjYogmgKGqjErCCnZrSNow",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## outreach.lists.uploadCsvList

- **Kind**: ORPC · **HTTP**: POST
- **Captured calls**: 3
- **Used by**: US-21
- **URL**: `https://api.crmchat.ai/v1/workspaces/zRQtzTiglfyVB5DtRm5Q/outreach/lists/upload`

### Input
_пустой / в URL_

### Output
Required:
- `createdAt: string`
- `createdBy: string`
- `id: string`
- `name: string`
- `source: object`
- `status: string`
- `updatedAt: string`
- `workspaceId: string`

Sample:
```json
{
  "createdAt": "2026-04-21T02:09:52.989Z",
  "createdBy": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
  "updatedAt": "2026-04-21T02:09:52.989Z",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "name": "csvFile.csv",
  "source": {
    "fileUrl": "https://firebasestorage.googleapis.com/v0/b/hints-crm.appspot.com/o/w%2FzRQtzTiglfyVB5DtRm5Q%2Foutreach%2Fleads%2FvI1vWOuaVrgt1zb9ZEVhU.csv?alt=media&token=0ae7ebd0-5a22-4191-aab6-e7618e179a91",
    "fileName": "csvFile.csv",
    "usernameColumn": "username",
    "phoneColumn": "username",
    "columns": [
      "username",
      ""
    ],
    "type": "csvFile"
  },
  "status": "pending",
  "id": "zsWrWrF3NF8hHFmsNyHG"
}
```

## outreach.removeLeadFromSequence

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 2
- **Used by**: US-25

### Input
Required:
- `leadId: string`
- `sequenceId: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "cZTBJZYTJlpYiLTkrLnM",
  "sequenceId": "uOYF8yFWnw2qNy5U1OXK",
  "leadId": "M6OIL04fPAEkr3Sz2z7A"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## outreach.rescheduleSequences

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 4
- **Used by**: US-18, US-26, US-27

### Input
Required:
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## outreach.resolveDuplicates

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-25

### Input
Required:
- `actionsMap: object`
- `sequenceId: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "4L1YDj39qRZJ23ACcD12",
  "sequenceId": "BCfOrBSLWNsUgLwJfirK",
  "actionsMap": {
    "HsoE4LTYEOLvliySVm6j": "keep",
    "vMr3SqCqN5uBUfUs4s5Y": "keep"
  }
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## outreach.sequences.create

- **Kind**: ORPC · **HTTP**: POST
- **Captured calls**: 3
- **Used by**: US-20, US-21
- **URL**: `https://api.crmchat.ai/v1/workspaces/zRQtzTiglfyVB5DtRm5Q/outreach/sequences`

### Input
Required:
- `listId: string`
- `messages: array`
- `name: string`

Sample:
```json
{
  "name": "csvFile.csv",
  "listId": "zsWrWrF3NF8hHFmsNyHG",
  "messages": []
}
```

### Output
Required:
- `createdAt: string`
- `createdBy: string`
- `id: string`
- `listId: string`
- `messages: array`
- `name: string`
- `status: string`
- `updatedAt: string`
- `workspaceId: string`

Sample:
```json
{
  "createdAt": "2026-04-21T02:09:54.218Z",
  "createdBy": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
  "updatedAt": "2026-04-21T02:09:54.218Z",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "listId": "zsWrWrF3NF8hHFmsNyHG",
  "name": "csvFile.csv",
  "status": "draft",
  "messages": [],
  "id": "GADmh7QJIyXjql37nfRq"
}
```

## outreach.sequences.delete

- **Kind**: ORPC · **HTTP**: DELETE
- **Captured calls**: 2
- **Used by**: US-26
- **URL**: `https://api.crmchat.ai/v1/workspaces/zRQtzTiglfyVB5DtRm5Q/outreach/sequences/GADmh7QJIyXjql37nfRq`

### Input
_пустой / в URL_

### Output
_пустой_

## outreach.sequences.patch

- **Kind**: ORPC · **HTTP**: PATCH
- **Captured calls**: 12
- **Used by**: US-22, US-23, US-24, US-30
- **URL**: `https://api.crmchat.ai/v1/workspaces/zRQtzTiglfyVB5DtRm5Q/outreach/sequences/GADmh7QJIyXjql37nfRq`

### Input
Optional:
- `accounts: object  (seen 3/12)`
- `contactCreationTrigger: string  (seen 2/12)`
- `contactDefaults: object  (seen 2/12)`
- `contactOwnerSettings: object  (seen 1/12)`
- `messages: array  (seen 5/12)`
- `name: string  (seen 1/12)`

Sample:
```json
{
  "accounts": {
    "mode": "selected",
    "selected": []
  }
}
```

### Output
Required:
- `createdAt: string`
- `createdBy: string`
- `id: string`
- `listId: string`
- `messages: array`
- `name: string`
- `status: string`
- `updatedAt: string`
- `workspaceId: string`
Optional:
- `accounts: object  (seen 5/12)`
- `completedLeadsCount: number  (seen 2/12)`
- `contactCreationTrigger: string  (seen 2/12)`
- `contactOwnerSettings: object  (seen 2/12)`
- `totalLeads: number  (seen 2/12)`

Sample:
```json
{
  "createdAt": "2026-04-21T02:09:54.218Z",
  "createdBy": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
  "updatedAt": "2026-04-21T02:10:03.045Z",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "listId": "zsWrWrF3NF8hHFmsNyHG",
  "name": "csvFile.csv",
  "status": "draft",
  "accounts": {
    "mode": "selected",
    "selected": []
  },
  "messages": [],
  "id": "GADmh7QJIyXjql37nfRq"
}
```

## outreach.updateLeadProperties

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 2
- **Used by**: US-25

### Input
Required:
- `leadId: string`
- `listId: string`
- `properties: object`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "4L1YDj39qRZJ23ACcD12",
  "leadId": "HsoE4LTYEOLvliySVm6j",
  "listId": "t9wsLZpHyrfxMZFLBD90",
  "properties": {}
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## outreach.updateSequenceStatus

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 8
- **Used by**: US-26

### Input
Required:
- `sequenceId: string`
- `status: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "sequenceId": "GADmh7QJIyXjql37nfRq",
  "status": "active"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## proxy.getCountries

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 7
- **Used by**: US-17

### Input
_пустой / в URL_

### Output
Required:
- `result: object`

Sample:
```json
{
  "result": {
    "data": [
      {
        "countryCode": "au",
        "name": "Австралия"
      },
      {
        "countryCode": "gb",
        "name": "Великобритания"
      },
      {
        "countryCode": "de",
        "name": "Германия"
      },
      {
        "countryCode": "ca",
        "name": "Канада"
      },
      {
        "countryCode": "nl",
        "name": "Нидерланды"
      },
      {
        "countryCode": "ru",
        "name": "Россия"
      },
      {
        "countryCode": "sg",
        "name": "Сингапур"
      },
      {
        "countryCode": "us",
        "name": "Соединенные Штаты"
      },
      {
        "countryCode": "fr",
        "name": "Франция"
      },
      {
        "countryCode": "jp",
        "name": "Япония"
      }
    ]
  }
}
```

## proxy.getProxyStatus

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 16
- **Used by**: US-10, US-14, US-17

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 6/16)`
- `firstName: string  (seen 6/16)`
- `isSandbox: boolean  (seen 6/16)`
- `productId: string  (seen 6/16)`
- `result: object  (seen 10/16)`
- `token: string  (seen 6/16)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3Mzc2MDV9.Kw1BbT_bsFh2c68WKIIOJn3omlbW2AxMft6d88PZfJ_cSJ4dz9Kr3HnzKQr0DQVcCzqcWqLVAyNwlhiKN1vS2g",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## telegram.account.auth

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 3
- **Used by**: US-17

### Input
Required:
- `accountId: string`
- `action: string`
- `workspaceId: string`
Optional:
- `device: object  (seen 2/3)`
- `phoneCode: string  (seen 1/3)`
- `phoneNumber: string  (seen 2/3)`
- `proxyCountryCode: string  (seen 2/3)`
- `transport: string  (seen 2/3)`

Sample:
```json
{
  "action": "start",
  "phoneNumber": "+79959037121",
  "proxyCountryCode": "ru",
  "device": {
    "platform": "Windows",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "langCode": "en",
    "systemLangCode": "en-US"
  },
  "transport": "ws",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "accountId": "6O7a8zSlVRThsooxfMkV"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## telegram.account.authState

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 36
- **Used by**: US-17

### Input
_пустой / в URL_

### Output
Optional:
- `accountId: string  (seen 2/36)`
- `codeHash: string  (seen 8/36)`
- `codeLength: number  (seen 8/36)`
- `email: string  (seen 1/36)`
- `error: object  (seen 13/36)`
- `firstName: string  (seen 1/36)`
- `isSandbox: boolean  (seen 1/36)`
- `method: string  (seen 8/36)`
- `nextType: string  (seen 8/36)`
- `productId: string  (seen 1/36)`
- `status: string  (seen 25/36)`
- `timeout: number  (seen 8/36)`
- `token: string  (seen 1/36)`
- `type: string  (seen 35/36)`

Sample:
```json
{
  "type": "idle",
  "status": "idle"
}
```

## telegram.account.getAccountConnectionData

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 10
- **Used by**: US-10, US-14

### Input
_пустой / в URL_

### Output
Optional:
- `authParams: string  (seen 6/10)`
- `email: string  (seen 4/10)`
- `firstName: string  (seen 4/10)`
- `isSandbox: boolean  (seen 4/10)`
- `productId: string  (seen 4/10)`
- `session: object  (seen 6/10)`
- `token: string  (seen 4/10)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3MzgxNzZ9.F0dQzQ8jeOnzuPe3CMA7YiFo3yGcVEKa_tK1Aget3Y6cnD8m-viRSRBxNBO0a7ES90dEB-WXClAQ4cdbv0CjvQ",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## telegram.account.moveAccounts

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-19

### Input
Required:
- `accountIds: array`
- `targetWorkspaceId: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "4L1YDj39qRZJ23ACcD12",
  "accountIds": [
    "QQOSRkbIurWwGtnUn9Xi"
  ],
  "targetWorkspaceId": "zRQtzTiglfyVB5DtRm5Q"
}
```

### Output
Required:
- `count: number`

Sample:
```json
{
  "count": 1
}
```

## telegram.account.updateAccount

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-18

### Input
Required:
- `accountId: string`
- `newLeadsDailyLimit: number`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "accountId": "6O7a8zSlVRThsooxfMkV",
  "newLeadsDailyLimit": 10
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## telegram.client.getFolders

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 10
- **Used by**: US-9

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 7/10)`
- `firstName: string  (seen 7/10)`
- `isSandbox: boolean  (seen 7/10)`
- `productId: string  (seen 7/10)`
- `status: string  (seen 3/10)`
- `token: string  (seen 7/10)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3NzcwMjB9.jeSET75lggUnREKXkkY5mptJ9-CIqyitOcAeRh1lJ8PgbDVo3pnZr9msuRkOsHLUD5mpv7Th4ut7Y_ujy9WF0g",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## telegram.client.getQrState

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 24
- **Used by**: US-9

### Input
_пустой / в URL_

### Output
Required:
- `status: string`
Optional:
- `expires: number  (seen 20/24)`
- `token: string  (seen 20/24)`

Sample:
```json
{
  "status": "scan-qr-code",
  "token": "AQT83+ZpJOD6hUpYDScZ5ZlxDotDi43OAlRFalBrsb0BNg==",
  "expires": 1776738300
}
```

## telegram.client.sendCode

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-9

### Input
Required:
- `phoneNumber: string`

Sample:
```json
{
  "phoneNumber": "79091513156"
}
```

### Output
Required:
- `isCodeViaApp: boolean`
- `phoneCodeHash: string`
- `status: string`

Sample:
```json
{
  "status": "sent",
  "phoneCodeHash": "5cc494137b5fc58427",
  "isCodeViaApp": true
}
```

## telegram.client.signIn

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-9

### Input
Required:
- `phoneCode: string`
- `phoneCodeHash: string`
- `phoneNumber: string`

Sample:
```json
{
  "phoneNumber": "79091513156",
  "phoneCode": "22100",
  "phoneCodeHash": "5cc494137b5fc58427"
}
```

### Output
Required:
- `status: string`

Sample:
```json
{
  "status": "password_needed"
}
```

## telegram.client.signInWithPassword

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 4
- **Used by**: US-9

### Input
Required:
- `password: string`

Sample:
```json
{
  "password": "fkg7h@4f3v6"
}
```

### Output
Required:
- `status: string`

Sample:
```json
{
  "status": "password_invalid"
}
```

## telegram.client.signOut

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 3
- **Used by**: US-9

### Input
_пустой / в URL_

Sample:
```json
{}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## telegram.client.status

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 19
- **Used by**: US-9

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 5/19)`
- `firstName: string  (seen 5/19)`
- `isSandbox: boolean  (seen 5/19)`
- `productId: string  (seen 5/19)`
- `status: string  (seen 14/19)`
- `token: string  (seen 5/19)`
- `user: object  (seen 5/19)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3MzgyNjV9.5Z62D7FgYkXu5j6sXMq3ajSRaCKFAHN7Z4g7iaFxdBC7zOOhaACm-SCyWpAoIlxkGNgk2yN5m3fBpjiICYdaEw",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## telegram.client.triggerSync

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 2
- **Used by**: US-9

### Input
Required:
- `folderId: string`

Sample:
```json
{
  "folderId": "9"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## workspace.changeWorkspaceMemberRole

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-4

### Input
Required:
- `role: string`
- `userId: string`
- `workspaceId: string`

Sample:
```json
{
  "workspaceId": "4L1YDj39qRZJ23ACcD12",
  "userId": "mNE0BClS3qUPRxRye5oABwJwEJi2",
  "role": "chatter"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## workspace.createWorkspace

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-1, US-5

### Input
Required:
- `name: string`
- `organizationId: string`

Sample:
```json
{
  "name": "test5",
  "organizationId": "HOgZBkDHwvEWuly71jdF"
}
```

### Output
Required:
- `createdAt: object`
- `createdBy: string`
- `id: string`
- `name: string`
- `organizationId: string`
- `updatedAt: object`

Sample:
```json
{
  "organizationId": "HOgZBkDHwvEWuly71jdF",
  "createdBy": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
  "name": "test5",
  "createdAt": {
    "_seconds": 1776778421,
    "_nanoseconds": 91000000
  },
  "updatedAt": {
    "_seconds": 1776778421,
    "_nanoseconds": 91000000
  },
  "id": "e1guNGI2dmB3GaBJX7N8"
}
```

## workspace.getPendingInvites

- **Kind**: TRPC · **HTTP**: GET
- **Captured calls**: 17
- **Used by**: US-2

### Input
_пустой / в URL_

### Output
Optional:
- `email: string  (seen 15/17)`
- `firstName: string  (seen 15/17)`
- `isSandbox: boolean  (seen 15/17)`
- `productId: string  (seen 15/17)`
- `token: string  (seen 15/17)`

Sample:
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJwcm9kdWN0SWQiOiJjcm1jaGF0LmFpIiwicHJvZHVjdFVzZXJJZCI6ImlOZWp2em9iYm1ReFJtelB0RUhENGhCeHF2UTIiLCJpYXQiOjE3NzY3Mzc4OTJ9.Oiz4vNi2sFGueAKUsw8itRo_XdvgkbfMK2UGsoXq2qP9cNIHkPWdm7fK1mYMCQ7DD1P_e3_3O1BClEuV7KdMeA",
  "productId": "crmchat.ai",
  "email": "uiNejvzobbmQxRmzPtEHD4hBxqvQ2@users.crmchat.ai",
  "firstName": "Вова Телеграмов",
  "isSandbox": false
}
```

## workspace.inviteWorkspaceMember

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 2
- **Used by**: US-2

### Input
Required:
- `role: string`
- `telegramUsername: string`
- `workspaceId: string`

Sample:
```json
{
  "telegramUsername": "mike1936",
  "role": "chatter",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q"
}
```

### Output
Required:
- `success: boolean`

Sample:
```json
{
  "success": true
}
```

## workspace.removeWorkspaceMember

- **Kind**: TRPC · **HTTP**: POST
- **Captured calls**: 1 _(optional-детектор отключён)_
- **Used by**: US-4

### Input
Required:
- `userId: string`
- `workspaceId: string`

Sample:
```json
{
  "userId": "mNE0BClS3qUPRxRye5oABwJwEJi2",
  "workspaceId": "4L1YDj39qRZJ23ACcD12"
}
```

### Output
_пустой_

Sample:
```json
[
  {
    "result": {}
  }
]
```

## workspaces.getMembers

- **Kind**: ORPC · **HTTP**: GET
- **Captured calls**: 148
- **Used by**: US-1, US-11, US-2, US-24, US-4, US-5, US-7
- **URL**: `https://api.crmchat.ai/v1/workspaces/4L1YDj39qRZJ23ACcD12/members`

### Input
_пустой / в URL_

### Output
Optional:
- `code: string  (seen 1/148)`
- `defined: boolean  (seen 1/148)`
- `message: string  (seen 1/148)`
- `status: number  (seen 1/148)`

Sample:
```json
[
  {
    "userId": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
    "role": "admin",
    "user": {
      "name": "Вова Телеграмов",
      "timezone": "Europe/Moscow",
      "telegramUsername": "vova_telegramov"
    }
  }
]
```

---

# Declared but not captured

35 proc'ов объявлены в коде, но ни разу не вызывались в нашей capture-сессии. Сигнатур нет — только имя и решение из `scope.rpc_decisions`.

| Proc | Kind | Decision | Reason |
|------|------|----------|--------|
| `account.deleteAccount` | TRPC | describe_by_code | невозвратно, не проходил в capture |
| `contact.createContactFromQr` | TRPC | skip | не понимаю UI-путь, не нужно |
| `contact.updateContactAvatar` | TRPC | skip | дергается автоматически из NonExistingLeadCard, UI нет |
| `contacts.create` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `contacts.delete` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `contacts.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `contacts.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `contacts.patch` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `organizations.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `organizations.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `organizations.patch` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `outreach.lists.createCrmList` | ORPC | skip | не понимаю UI-путь, не нужно |
| `outreach.sendOutreachMessageNow` | TRPC | exclude | DevSendMessageNow — NODE_ENV===development only |
| `outreach.sequences.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `outreach.sequences.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `outreach.validateTextVariables` | TRPC | describe_by_code | валидация {{vars}} в редакторе рассылки |
| `properties.create` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `properties.delete` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `properties.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `properties.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `properties.patch` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `telegram.account.reauthenticateWebClient` | TRPC | describe_by_code | триггерится при session break |
| `telegram.account.submitReauthPassword` | TRPC | describe_by_code | парная к reauthenticateWebClient |
| `telegram.account.toggleWarmup` | TRPC | later | warmup feature — отдельная итерация |
| `telegram.account.triggerWarmupSession` | TRPC | later | warmup feature — отдельная итерация |
| `telegram.authenticateByInitData` | TRPC | exclude | mini-app only (TG WebApp) |
| `telegramAccounts.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `telegramAccounts.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `telegramAccounts.patch` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `telegramRaw.call` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `workspace.acceptWorkspaceInvite` | TRPC | describe_by_code | deep-link accept, нужен второй юзер |
| `workspace.getWorkspaceInvite` | TRPC | describe_by_code | deep-link /accept-invite/{token}, нужен второй юзер |
| `workspaces.get` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `workspaces.list` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |
| `workspaces.patch` | ORPC | exclude | public REST API (oRPC contract) — out of scope вместе с /settings/api-keys |

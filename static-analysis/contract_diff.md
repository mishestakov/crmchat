# Contract diff — client bundle vs official OpenAPI

- client endpoints (`api-contract.generated.json`): **28**
- spec endpoints (`api-docs/spec.json`): **27**
- common: **27**
- only in client (not in public spec): `telegramRaw.call`
- only in spec (not in client bundle): `—`
- webhooks in spec: `contact.created, contact.updated, contact.deleted`
- **all common-endpoint method+path+tag fields match: YES**


## Per-endpoint spec signal (what code cannot see)

| endpoint | params | body | responses |
|---|---|---|---|
| `contacts.create` | 1 | yes | 200, 400, 401, 403, 404 |
| `contacts.delete` | 2 | yes | 200, 401, 403, 404 |
| `contacts.get` | 2 | — | 200, 401, 403, 404 |
| `contacts.list` | 5 | — | 200, 401, 403, 404 |
| `contacts.patch` | 2 | yes | 200, 400, 401, 403, 404 |
| `organizations.get` | 1 | — | 200, 401, 403, 404 |
| `organizations.list` | 3 | — | 200, 401 |
| `organizations.patch` | 1 | yes | 200, 400, 401, 403, 404 |
| `outreach.lists.createCrmList` | 1 | yes | 200, 400, 401, 403, 404 |
| `outreach.lists.uploadCsvList` | 1 | yes | 200, 400, 401, 403 |
| `outreach.sequences.create` | 1 | yes | 200, 400, 401, 403, 404 |
| `outreach.sequences.delete` | 2 | yes | 200, 401, 403, 404, 409 |
| `outreach.sequences.get` | 2 | — | 200, 401, 403, 404 |
| `outreach.sequences.list` | 4 | — | 200, 401, 403 |
| `outreach.sequences.patch` | 2 | yes | 200, 400, 401, 403, 404 |
| `properties.create` | 2 | yes | 200, 400, 401, 403, 404, 409 |
| `properties.delete` | 3 | yes | 200, 400, 401, 403, 404 |
| `properties.get` | 3 | — | 200, 401, 403, 404 |
| `properties.list` | 2 | — | 200, 401, 403, 404 |
| `properties.patch` | 3 | yes | 200, 400, 401, 403, 404 |
| `telegramAccounts.get` | 2 | — | 200, 401, 403, 404 |
| `telegramAccounts.list` | 4 | — | 200, 401, 403 |
| `telegramAccounts.patch` | 2 | yes | 200, 400, 401, 403, 404 |
| `workspaces.get` | 1 | — | 200, 401, 403, 404 |
| `workspaces.getMembers` | 1 | — | 200, 401, 403 |
| `workspaces.list` | 4 | — | 200, 401, 403 |
| `workspaces.patch` | 1 | yes | 200, 400, 401, 403, 404 |
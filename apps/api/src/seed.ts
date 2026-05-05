import { db, sql } from "./db/client";
import {
  contacts,
  users,
  workspaceMembers,
  workspaces,
} from "./db/schema";
import { seedDefaultProperties } from "./lib/workspace-presets";

// Фиксированные id — чтобы dev-данные были предсказуемы между перезапусками.
// `tgUserId` — синтетические отрицательные строки, чтобы не пересечься с
// реальным TG user_id (positive int64). При логине через TG-OIDC sub будет
// положительный → seed-юзеры не сматчатся, создастся новая row.
const DEV_USERS = [
  { id: "usr_anna", tgUserId: "-1", name: "Анна" },
  { id: "usr_boris", tgUserId: "-2", name: "Борис" },
  { id: "usr_vera", tgUserId: "-3", name: "Вера" },
] as const;

for (const u of DEV_USERS) {
  await db
    .insert(users)
    .values(u)
    .onConflictDoUpdate({
      target: users.id,
      set: { name: u.name, updatedAt: new Date() },
    });
  console.log(`upserted user ${u.id}`);
}

// Demo workspace для Анны: фикс-id, идемпотентно.
const ANNA_ID = DEV_USERS[0].id;
const DEMO_WS_ID = "ws_demo";
const IVAN_ID = "cont_ivan";
const MARIA_ID = "cont_maria";

await db
  .insert(workspaces)
  .values({
    id: DEMO_WS_ID,
    name: "Demo",
    createdBy: ANNA_ID,
  })
  .onConflictDoNothing({ target: workspaces.id });

// Backfill: каждый существующий workspace должен иметь creator в
// workspace_members с ролью admin. Без этого после миграции на membership
// (этап 1 фичи приглашений) creator перестанет видеть свой ws.
// Идемпотентно через ON CONFLICT — повторный запуск seed безопасен.
const allWorkspaces = await db
  .select({ id: workspaces.id, createdBy: workspaces.createdBy })
  .from(workspaces);
for (const ws of allWorkspaces) {
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: ws.id, userId: ws.createdBy, role: "admin" })
    .onConflictDoNothing();
}
console.log(`backfilled ${allWorkspaces.length} workspace_members rows`);

// Preset properties для Demo workspace — через тот же helper, что и в POST /workspaces.
// Идемпотентно (onConflictDoNothing по [workspaceId, key]).
await seedDefaultProperties(DEMO_WS_ID);

await db
  .insert(contacts)
  .values([
    {
      id: IVAN_ID,
      workspaceId: DEMO_WS_ID,
      properties: {
        full_name: "Иван Петров",
        email: "ivan@example.com",
        stage: "lead",
        amount: 50000,
      },
      createdBy: ANNA_ID,
    },
    {
      id: MARIA_ID,
      workspaceId: DEMO_WS_ID,
      properties: {
        full_name: "Мария Сидорова",
        phone: "+79001234567",
        stage: "talk",
      },
      createdBy: ANNA_ID,
    },
  ])
  .onConflictDoNothing({ target: contacts.id });

console.log("seeded demo workspace + preset properties + contacts");

await sql.end();

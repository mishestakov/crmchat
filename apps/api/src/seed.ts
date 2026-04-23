import { eq } from "drizzle-orm";
import { db, sql } from "./db/client";
import {
  contacts,
  organizations,
  users,
  workspaces,
} from "./db/schema";
import { seedDefaultProperties } from "./lib/workspace-presets";

// Фиксированные id — чтобы dev-данные были предсказуемы между перезапусками.
// Формат — читаемый префикс (usr_/ws_/cont_), не как 12-hex рантайм-id (см.
// short-id.ts). Так в логах сразу видно, что строка из seed'а.
const DEV_USERS = [
  { id: "usr_anna", email: "anna@local", name: "Анна" },
  { id: "usr_boris", email: "boris@local", name: "Борис" },
  { id: "usr_vera", email: "vera@local", name: "Вера" },
] as const;

for (const u of DEV_USERS) {
  await db
    .insert(users)
    .values(u)
    .onConflictDoUpdate({
      target: users.id,
      set: { email: u.email, name: u.name, updatedAt: new Date() },
    });
  console.log(`upserted user ${u.email}`);
}

// Каждому dev-user — своя organization, чтобы он мог создавать workspaces.
// При боевом OAuth onboarding-flow будет создавать org через тот же helper.
for (const u of DEV_USERS) {
  const [existingOrg] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.createdBy, u.id))
    .limit(1);
  if (existingOrg) {
    console.log(`org for ${u.email} already exists`);
    continue;
  }
  await db
    .insert(organizations)
    .values({ name: `${u.name} Org`, createdBy: u.id });
  console.log(`seeded org for ${u.email}`);
}

// Demo workspace для Анны: фикс-id, идемпотентно.
const ANNA_ID = DEV_USERS[0].id;
const DEMO_WS_ID = "ws_demo";
const IVAN_ID = "cont_ivan";
const MARIA_ID = "cont_maria";

const [annaOrg] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.createdBy, ANNA_ID))
  .limit(1);

if (!annaOrg) throw new Error("Anna's organization missing — re-run seed");

await db
  .insert(workspaces)
  .values({
    id: DEMO_WS_ID,
    organizationId: annaOrg.id,
    name: "Demo",
    createdBy: ANNA_ID,
  })
  .onConflictDoNothing({ target: workspaces.id });

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

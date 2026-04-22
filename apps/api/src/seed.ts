import { eq } from "drizzle-orm";
import { db, sql } from "./db/client";
import { organizations, users } from "./db/schema";

// Фиксированные UUID — чтобы dev-данные были предсказуемы между перезапусками.
const DEV_USERS = [
  {
    id: "00000000-0000-0000-0000-0000000d3eff",
    email: "anna@local",
    name: "Анна",
  },
  {
    id: "00000000-0000-0000-0000-0000000d3ef1",
    email: "boris@local",
    name: "Борис",
  },
  {
    id: "00000000-0000-0000-0000-0000000d3ef2",
    email: "vera@local",
    name: "Вера",
  },
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

await sql.end();

import { eq } from "drizzle-orm";
import { db, sql } from "./db/client";
import { organizations, users } from "./db/schema";

const devUserId = process.env.DEV_USER_ID;
if (!devUserId) {
  console.error("DEV_USER_ID is not set");
  process.exit(1);
}

const [existingUser] = await db
  .select()
  .from(users)
  .where(eq(users.id, devUserId))
  .limit(1);

if (!existingUser) {
  await db.insert(users).values({
    id: devUserId,
    email: "dev@local",
    name: "Dev User",
  });
  console.log("seeded dev user");
} else {
  console.log("dev user already exists");
}

const [existingOrg] = await db.select().from(organizations).limit(1);
if (!existingOrg) {
  await db.insert(organizations).values({
    name: "Default",
    createdBy: devUserId,
  });
  console.log("seeded default organization");
} else {
  console.log("organization already exists");
}

await sql.end();

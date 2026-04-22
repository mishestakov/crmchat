import { defineConfig } from "drizzle-kit";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// drizzle-kit запускается отдельным процессом (не Bun) и не видит root .env.
// Грузим вручную — без зависимости на dotenv.
const here = dirname(fileURLToPath(import.meta.url));
try {
  const content = readFileSync(resolve(here, "../../.env"), "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (m && m[1] && m[2] !== undefined && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
} catch {}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

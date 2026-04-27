import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { existsSync, readdirSync, statSync } from 'node:fs';

const dbDir = resolve(import.meta.dirname, 'td-database');

if (!existsSync(dbDir)) {
  throw new Error('Run 01-tdlib-auth.ts first to create td-database/');
}

console.log('=== files in td-database/ ===');
for (const name of readdirSync(dbDir)) {
  const s = statSync(resolve(dbDir, name));
  console.log(`  ${s.isDirectory() ? 'd' : 'f'} ${name.padEnd(30)} ${s.size} bytes`);
}

const candidates = ['td.binlog', 'td.binlog.new', 'td.binlog.old'];
for (const name of candidates) {
  const path = resolve(dbDir, name);
  if (!existsSync(path)) continue;

  console.log(`\n=== ${name} ===`);
  let db: Database.Database;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.log(`  open failed: ${(e as Error).message}`);
    continue;
  }

  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    console.log(`  tables: ${tables.map((t) => t.name).join(', ') || '(none)'}`);

    for (const { name: tbl } of tables) {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all() as any[];
      const count = (db.prepare(`SELECT COUNT(*) AS c FROM ${tbl}`).get() as any).c;
      console.log(`  - ${tbl} [${cols.map((c) => `${c.name}:${c.type}`).join(', ')}] rows=${count}`);

      const rows = db.prepare(`SELECT * FROM ${tbl} LIMIT 50`).all() as Record<string, unknown>[];
      for (const row of rows) {
        const summary: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (Buffer.isBuffer(v)) {
            summary[k] = `<blob ${v.length}B> ${v.subarray(0, 32).toString('hex')}…`;
          } else if (typeof v === 'string' && v.length > 80) {
            summary[k] = v.slice(0, 80) + '…';
          } else {
            summary[k] = String(v);
          }
        }
        console.log('    ', JSON.stringify(summary));
      }
    }
  } catch (e) {
    console.log(`  query failed (encrypted?): ${(e as Error).message}`);
    console.log(`  → likely SQLCipher-encrypted, would need database_encryption_key`);
  } finally {
    db.close();
  }
}

import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Applies the "-- Up Migration" half of db/migrations/*.sql in order. Only used for PGlite (tests,
 * local E2E); real databases are migrated by node-pg-migrate, which keeps its own bookkeeping table.
 */
export async function migrate(
  exec: (sql: string) => Promise<void>,
  query: (sql: string) => Promise<unknown[]>,
) {
  await exec("CREATE TABLE IF NOT EXISTS pglite_migrations (name text PRIMARY KEY)");
  const applied = new Set(
    ((await query("SELECT name FROM pglite_migrations")) as { name: string }[]).map((r) => r.name),
  );
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(path.join(dir, file), "utf8");
    const up = text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, "");
    await exec(
      `BEGIN; ${up}; INSERT INTO pglite_migrations (name) VALUES ('${file.replace(/'/g, "''")}'); COMMIT;`,
    );
  }
}

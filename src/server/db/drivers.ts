import "server-only";

import type { Db } from "./client";

/**
 * Picks a driver from the connection string:
 * - `*.neon.tech` -> Neon serverless HTTP (production, previews, Neon dev branches)
 * - `pglite:<dir>` or `pglite:memory` -> in-process PGlite (local dev and E2E without a server)
 * - anything else -> node-postgres (CI's Postgres service container, a local Postgres)
 */
export async function createDb(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) return createPgliteDb(url.slice("pglite:".length));
  if (new URL(url).hostname.endsWith(".neon.tech")) return createNeonDb(url);
  return createPgDb(url);
}

async function createNeonDb(url: string): Promise<Db> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  return {
    query: async <Row>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as Row[],
  };
}

async function createPgDb(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    query: async <Row>(text: string, params: unknown[] = []) =>
      (await pool.query(text, params)).rows as Row[],
  };
}

async function createPgliteDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dataDir === "memory" ? undefined : dataDir);
  const { migrate } = await import("./migrate-sql");
  await migrate(
    (sql) => db.exec(sql).then(() => undefined),
    (text) => db.query(text).then((r) => r.rows),
  );
  return {
    query: async <Row>(text: string, params: unknown[] = []) => (await db.query<Row>(text, params)).rows,
  };
}

import { PGlite } from "@electric-sql/pglite";

import type { Db } from "@/server/db";
import { migrate } from "@/server/db/migrate-sql";

/**
 * A fresh migrated database per test file. Uses TEST_DATABASE_URL (CI's Postgres service, a Neon
 * dev branch) when set, otherwise an in-memory PGlite so `pnpm test` needs nothing installed.
 */
export async function createTestDb(): Promise<Db & { close(): Promise<void>; reset(): Promise<void> }> {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    await migrate(
      async (sql) => void (await pool.query(sql)),
      async (sql) => (await pool.query(sql)).rows,
    );
    return {
      query: async <Row>(text: string, params: unknown[] = []) =>
        (await pool.query(text, params)).rows as Row[],
      reset: async () =>
        void (await pool.query("TRUNCATE games, profiles, friendships, table_invites CASCADE")),
      close: () => pool.end(),
    };
  }
  const pglite = new PGlite();
  await migrate(
    (sql) => pglite.exec(sql).then(() => undefined),
    (sql) => pglite.query(sql).then((r) => r.rows),
  );
  return {
    query: async <Row>(text: string, params: unknown[] = []) => (await pglite.query<Row>(text, params)).rows,
    reset: async () =>
      void (await pglite.exec("TRUNCATE games, profiles, friendships, table_invites CASCADE")),
    close: () => pglite.close(),
  };
}

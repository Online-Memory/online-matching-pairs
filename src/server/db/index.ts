import "server-only";

import { getEnv } from "@/lib/env";

import type { Db } from "./client";
import { createDb } from "./drivers";

export * from "./client";

const globalForDb = globalThis as unknown as { __ompDb?: Promise<Db> };

/** One client per server process (route bundles share it through globalThis). */
export function getDb(): Promise<Db> {
  globalForDb.__ompDb ??= createDb(getEnv().DATABASE_URL);
  return globalForDb.__ompDb;
}

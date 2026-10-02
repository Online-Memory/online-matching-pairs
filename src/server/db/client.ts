import "server-only";

/**
 * The whole app talks to Postgres through this one method: a single parameterised statement.
 * Multi-table writes are expressed as one statement with data-modifying CTEs, so no driver needs
 * interactive transactions (the Neon HTTP driver doesn't have them).
 */
export interface Db {
  query<Row = Record<string, unknown>>(text: string, params?: unknown[]): Promise<Row[]>;
}

/** Postgres error code for unique violations. */
export const UNIQUE_VIOLATION = "23505";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

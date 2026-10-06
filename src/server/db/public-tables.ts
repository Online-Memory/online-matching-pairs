import "server-only";

import { z } from "zod";

import type { PublicTableEntry } from "@/lib/protocol";

import type { Db } from "./client";

const rowSchema = z.object({
  code: z.string(),
  theme: z.string(),
  pairs: z.number().int(),
  status: z.enum(["lobby", "playing"]),
  player_count: z.number().int(),
  max_players: z.number().int(),
  host_name: z.string(),
  table_name: z.string(),
  created_at: z.union([z.string(), z.date()]),
});

const toTimestamp = (ms: number) => new Date(ms).toISOString();

/**
 * The public directory. Reads `games` only, never `table_state`. Abandonment is only recorded when
 * someone polls a table, so recency bounds keep dead lobbies from lingering in the list.
 */
export async function listPublicTables(
  db: Db,
  window: { lobbySince: number; playingSince: number; limit: number },
): Promise<PublicTableEntry[]> {
  const rows = await db.query(
    `SELECT code, theme, pairs, status, player_count, max_players, host_name, table_name, created_at
       FROM games
      WHERE is_public
        AND ((status = 'lobby' AND created_at > $1::timestamptz)
          OR (status = 'playing' AND started_at > $2::timestamptz))
      ORDER BY created_at DESC
      LIMIT $3`,
    [toTimestamp(window.lobbySince), toTimestamp(window.playingSince), window.limit],
  );
  return rows.map((row) => {
    const r = rowSchema.parse(row);
    return {
      code: r.code,
      tableName: r.table_name,
      theme: r.theme,
      pairs: r.pairs,
      status: r.status,
      seats: { taken: r.player_count, max: r.max_players },
      hostName: r.host_name,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

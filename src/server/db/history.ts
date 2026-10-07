import "server-only";

import { z } from "zod";

import type { HistoryEntry } from "@/lib/protocol";

import type { Db } from "./client";

const historyRowSchema = z.object({
  code: z.string(),
  theme: z.string(),
  pairs: z.number().int(),
  finished_at: z.union([z.date(), z.string()]),
  players: z.array(
    z.object({
      player_id: z.string(),
      user_id: z.string().nullable(),
      display_name: z.string(),
      pairs: z.number().int(),
      moves: z.number().int(),
      best_streak: z.number().int(),
      rank: z.number().int().nullable(),
      rating_before: z.number().int().nullable(),
      rating_after: z.number().int().nullable(),
    }),
  ),
});

/** Finished games for a signed-in user. Reads only public tables, never `table_state`. */
export async function listHistory(
  db: Db,
  userId: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<HistoryEntry[]> {
  const rows = await db.query(
    `SELECT g.code, g.theme, g.pairs, g.finished_at,
            (SELECT jsonb_agg(jsonb_build_object(
                      'player_id', o.player_id, 'user_id', o.user_id, 'display_name', o.display_name,
                      'pairs', o.pairs, 'moves', o.moves, 'best_streak', o.best_streak, 'rank', o.rank,
                      'rating_before', o.rating_before, 'rating_after', o.rating_after)
                    ORDER BY o.rank NULLS LAST, o.seat)
               FROM game_players o WHERE o.game_id = g.id) AS players
       FROM game_players me
       JOIN games g ON g.id = me.game_id
      WHERE me.user_id = $1 AND g.status = 'finished'
      ORDER BY g.finished_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  return rows.map((raw) => {
    const row = historyRowSchema.parse(raw);
    const me = row.players.find((p) => p.user_id === userId)!;
    return {
      code: row.code,
      theme: row.theme,
      pairs: row.pairs,
      finishedAt: new Date(row.finished_at).toISOString(),
      you: {
        pairs: me.pairs,
        moves: me.moves,
        bestStreak: me.best_streak,
        rank: me.rank,
        ratingBefore: me.rating_before,
        ratingAfter: me.rating_after,
      },
      players: row.players.map((p) => ({
        name: p.display_name,
        pairs: p.pairs,
        rank: p.rank,
        isYou: p.user_id === userId,
      })),
    };
  });
}

/** How many finished games `listHistory` can page through for this user. */
export async function countHistory(db: Db, userId: string): Promise<number> {
  const [row] = await db.query<{ total: number | string }>(
    `SELECT count(*) AS total
       FROM game_players me
       JOIN games g ON g.id = me.game_id
      WHERE me.user_id = $1 AND g.status = 'finished'`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

import "server-only";

import { z } from "zod";

import { pairKey, REPEAT_WINDOW_HOURS } from "@/server/ratings/rating";

import type { Db } from "./client";

const ids = (userIds: string[]) => JSON.stringify(userIds);

const gameRowSchema = z.object({ user_id: z.string().nullable(), rank: z.number().int().nullable() });

/** The signed-in, ranked players of a finished, not-yet-rated game; null if there is nothing to rate. */
export async function loadGameToRate(db: Db, gameId: string) {
  const rows = await db.query(
    `SELECT gp.user_id, gp.rank
       FROM games g
       LEFT JOIN game_players gp
         ON gp.game_id = g.id AND gp.user_id IS NOT NULL AND gp.rank IS NOT NULL
      WHERE g.id = $1 AND g.status = 'finished' AND g.rated_at IS NULL`,
    [gameId],
  );
  if (rows.length === 0) return null;
  const participants = new Map<string, number>();
  for (const raw of rows) {
    const row = gameRowSchema.parse(raw);
    if (row.user_id !== null && row.rank !== null) participants.set(row.user_id, row.rank);
  }
  return { participants: [...participants].map(([userId, rank]) => ({ userId, rank })) };
}

/** A finished game with nothing to rate (guests only, a solo game): mark it so the sweeper skips it. */
export async function markUnratable(db: Db, gameId: string, at: string) {
  await db.query(
    `UPDATE games SET rated_at = $2::timestamptz WHERE id = $1 AND status = 'finished' AND rated_at IS NULL`,
    [gameId, at],
  );
}

export async function ensureRatingRows(db: Db, userIds: string[]) {
  await db.query(
    `INSERT INTO player_ratings (user_id)
     SELECT jsonb_array_elements_text($1::jsonb)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids(userIds)],
  );
}

const ratingRowSchema = z.object({
  user_id: z.string(),
  rating: z.number().int(),
  rated_games: z.number().int(),
  version: z.number().int(),
});

export async function loadRatings(db: Db, userIds: string[]) {
  const rows = await db.query(
    `SELECT user_id, rating, rated_games, version FROM player_ratings
      WHERE user_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [ids(userIds)],
  );
  return new Map(
    rows.map((raw) => {
      const r = ratingRowSchema.parse(raw);
      return [r.user_id, { rating: r.rating, ratedGames: r.rated_games, version: r.version }] as const;
    }),
  );
}

/** How many rated games each pair among `userIds` shared in the window before this game finished. */
export async function loadRepeatCounts(db: Db, gameId: string, userIds: string[]) {
  const rows = await db.query<{ a: string; b: string; n: number }>(
    `SELECT a.user_id AS a, b.user_id AS b, count(*)::int AS n
       FROM games cur
       JOIN games g ON g.id <> cur.id AND g.status = 'finished'
                   AND g.finished_at <= cur.finished_at
                   AND g.finished_at > cur.finished_at - ($3::int * interval '1 hour')
       JOIN game_players a ON a.game_id = g.id AND a.rating_after IS NOT NULL
       JOIN game_players b ON b.game_id = g.id AND b.rating_after IS NOT NULL AND a.user_id < b.user_id
      WHERE cur.id = $1
        AND a.user_id IN (SELECT jsonb_array_elements_text($2::jsonb))
        AND b.user_id IN (SELECT jsonb_array_elements_text($2::jsonb))
      GROUP BY a.user_id, b.user_id`,
    [gameId, ids(userIds), REPEAT_WINDOW_HOURS],
  );
  return new Map(rows.map((r) => [pairKey(r.a, r.b), Number(r.n)] as const));
}

export type RatingUpdate = {
  userId: string;
  expectedVersion: number;
  ratingBefore: number;
  ratingAfter: number;
  won: boolean;
};

/**
 * Claims the game and applies every player's new rating in ONE statement. `ok` locks the player rows
 * (FOR UPDATE) and counts how many still have the version we read; if any moved, nothing is claimed
 * and nothing is written, so the caller re-reads and retries. A game already rated is never claimed
 * twice. Returns true only when this call claimed the game.
 */
export async function applyRatings(db: Db, gameId: string, at: string, updates: RatingUpdate[]) {
  const input = updates.map((u) => ({
    user_id: u.userId,
    expected_version: u.expectedVersion,
    rating_before: u.ratingBefore,
    rating_after: u.ratingAfter,
    won: u.won,
  }));
  const rows = await db.query<{ claimed: number }>(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb)
         AS x(user_id text, expected_version int, rating_before int, rating_after int, won boolean)
     ), ok AS (
       SELECT count(*) = (SELECT count(*) FROM input) AS ok
         FROM (SELECT 1 FROM player_ratings p JOIN input i ON i.user_id = p.user_id
                WHERE p.version = i.expected_version FOR UPDATE OF p) locked
     ), claim AS (
       UPDATE games SET rated_at = $2::timestamptz
        WHERE id = $1 AND status = 'finished' AND rated_at IS NULL AND (SELECT ok FROM ok)
       RETURNING id
     ), upd AS (
       UPDATE player_ratings pr
          SET rating = i.rating_after, rated_games = pr.rated_games + 1,
              wins = pr.wins + CASE WHEN i.won THEN 1 ELSE 0 END,
              version = pr.version + 1, updated_at = $2::timestamptz
         FROM input i
        WHERE pr.user_id = i.user_id AND pr.version = i.expected_version AND EXISTS (SELECT 1 FROM claim)
       RETURNING pr.user_id
     ), gp AS (
       UPDATE game_players g SET rating_before = i.rating_before, rating_after = i.rating_after
         FROM input i
        WHERE g.game_id = $1 AND g.user_id = i.user_id AND EXISTS (SELECT 1 FROM claim)
       RETURNING g.user_id
     )
     SELECT (SELECT count(*) FROM claim)::int AS claimed`,
    [gameId, at, JSON.stringify(input)],
  );
  return Number(rows[0]?.claimed) === 1;
}

/** Finished games nobody rated yet, oldest first. */
export async function listUnrated(db: Db, limit: number) {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM games
      WHERE status = 'finished' AND rated_at IS NULL
      ORDER BY finished_at NULLS FIRST, id
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

const leaderboardRowSchema = z.object({
  position: z.number().int(),
  user_id: z.string(),
  handle: z.string().nullable(),
  display_name: z.string().nullable(),
  rating: z.number().int(),
  rated_games: z.number().int(),
  wins: z.number().int(),
});

export type LeaderboardRow = {
  position: number;
  userId: string;
  handle: string | null;
  name: string | null;
  rating: number;
  ratedGames: number;
  wins: number;
};

/** Top `limit` plus the viewer's own row. `userIds: null` is the global board. */
export async function queryLeaderboard(
  db: Db,
  opts: { userIds: string[] | null; limit: number; meId: string | null },
): Promise<LeaderboardRow[]> {
  const rows = await db.query(
    `WITH ranked AS (
       SELECT pr.user_id, pr.rating, pr.rated_games, pr.wins, p.handle, p.display_name,
              (row_number() OVER (ORDER BY pr.rating DESC, pr.rated_games DESC, pr.user_id))::int AS position
         FROM player_ratings pr
         LEFT JOIN profiles p ON p.user_id = pr.user_id
        WHERE $1::jsonb IS NULL OR pr.user_id IN (SELECT jsonb_array_elements_text($1::jsonb))
     )
     SELECT * FROM ranked WHERE position <= $2::int OR user_id = $3::text ORDER BY position`,
    [opts.userIds === null ? null : ids(opts.userIds), opts.limit, opts.meId],
  );
  return rows.map((raw) => {
    const r = leaderboardRowSchema.parse(raw);
    return {
      position: r.position,
      userId: r.user_id,
      handle: r.handle,
      name: r.display_name,
      rating: r.rating,
      ratedGames: r.rated_games,
      wins: r.wins,
    };
  });
}

const statsRowSchema = z.object({
  games: z.number().int(),
  versus_games: z.number().int(),
  wins: z.number().int(),
  best_streak: z.number().int(),
  pairs: z.number().int(),
  moves: z.number().int(),
});

/** Lifetime numbers for a signed-in user, from finished games (casual ones included). */
export async function queryStats(db: Db, userId: string) {
  const rows = await db.query(
    `WITH mine AS (
       SELECT gp.rank, gp.best_streak, gp.pairs, gp.moves,
              (SELECT count(*) FROM game_players o WHERE o.game_id = gp.game_id) AS seated
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'finished'
     )
     SELECT count(*)::int AS games,
            (count(*) FILTER (WHERE seated >= 2))::int AS versus_games,
            (count(*) FILTER (WHERE seated >= 2 AND rank = 1))::int AS wins,
            coalesce(max(best_streak), 0)::int AS best_streak,
            coalesce(sum(pairs), 0)::int AS pairs,
            coalesce(sum(moves), 0)::int AS moves
       FROM mine`,
    [userId],
  );
  const r = statsRowSchema.parse(rows[0]);
  return {
    games: r.games,
    versusGames: r.versus_games,
    wins: r.wins,
    bestStreak: r.best_streak,
    pairs: r.pairs,
    moves: r.moves,
  };
}

const myRatingSchema = z.object({
  rating: z.number().int(),
  rated_games: z.number().int(),
  wins: z.number().int(),
  position: z.number().int(),
});

export async function queryRating(db: Db, userId: string) {
  const rows = await db.query(
    `SELECT me.rating, me.rated_games, me.wins,
            ((SELECT count(*) FROM player_ratings o
               WHERE o.rating > me.rating
                  OR (o.rating = me.rating AND (o.rated_games > me.rated_games
                      OR (o.rated_games = me.rated_games AND o.user_id < me.user_id)))) + 1)::int AS position
       FROM player_ratings me WHERE me.user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = myRatingSchema.parse(rows[0]);
  return { rating: r.rating, ratedGames: r.rated_games, wins: r.wins, position: r.position };
}

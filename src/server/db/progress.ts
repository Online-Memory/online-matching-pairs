import "server-only";

import { z } from "zod";

import type { Lifetime } from "@/lib/progress/achievements";

import type { Db } from "./client";

const ids = (userIds: string[]) => JSON.stringify(userIds);

const gameRowSchema = z.object({
  user_id: z.string().nullable(),
  pairs: z.number().int(),
  best_streak: z.number().int(),
  rank: z.number().int().nullable(),
  seated: z.number().int(),
});

/**
 * The seated players of a finished game whose XP has not been awarded; null if there is nothing to award.
 * `seated` counts guests too: position XP only needs someone else at the table.
 */
export async function loadGameToAward(db: Db, gameId: string) {
  const rows = await db.query(
    `SELECT gp.user_id, gp.pairs, gp.best_streak, gp.rank,
            (SELECT count(*) FROM game_players o WHERE o.game_id = g.id)::int AS seated
       FROM games g JOIN game_players gp ON gp.game_id = g.id
      WHERE g.id = $1 AND g.status = 'finished' AND g.progress_applied_at IS NULL`,
    [gameId],
  );
  if (rows.length === 0) return null;
  const parsed = rows.map((raw) => gameRowSchema.parse(raw));
  return {
    seated: parsed[0]!.seated,
    participants: parsed.flatMap((r) =>
      r.user_id === null
        ? []
        : [{ userId: r.user_id, pairs: r.pairs, bestStreak: r.best_streak, rank: r.rank }],
    ),
  };
}

/** A finished game with nobody to pay (guests only): mark it so the sweeper skips it. */
export async function markNoProgress(db: Db, gameId: string, at: string) {
  await db.query(
    `UPDATE games SET progress_applied_at = $2::timestamptz
      WHERE id = $1 AND status = 'finished' AND progress_applied_at IS NULL`,
    [gameId, at],
  );
}

export async function ensureProgressRows(db: Db, userIds: string[]) {
  await db.query(
    `INSERT INTO player_progress (user_id)
     SELECT jsonb_array_elements_text($1::jsonb)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids(userIds)],
  );
}

const progressRowSchema = z.object({ user_id: z.string(), xp: z.number().int(), version: z.number().int() });

export async function loadProgress(db: Db, userIds: string[]) {
  const rows = await db.query(
    `SELECT user_id, xp, version FROM player_progress
      WHERE user_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [ids(userIds)],
  );
  return new Map(
    rows.map((raw) => {
      const r = progressRowSchema.parse(raw);
      return [r.user_id, { xp: r.xp, version: r.version }] as const;
    }),
  );
}

export type ProgressUpdate = { userId: string; expectedVersion: number; gained: number; xpAfter: number };

/**
 * Claims the game and applies every player's XP in ONE statement, the way `applyRatings` does: `ok` locks
 * the player rows and counts how many still have the version we read; if any moved, nothing is claimed
 * and nothing is written, so the caller re-reads and retries. A game already awarded is never claimed
 * twice. Returns true only when this call claimed the game.
 */
export async function applyProgress(db: Db, gameId: string, at: string, updates: ProgressUpdate[]) {
  const input = updates.map((u) => ({
    user_id: u.userId,
    expected_version: u.expectedVersion,
    gained: u.gained,
    xp_after: u.xpAfter,
  }));
  const rows = await db.query<{ claimed: number }>(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb)
         AS x(user_id text, expected_version int, gained int, xp_after int)
     ), ok AS (
       SELECT count(*) = (SELECT count(*) FROM input) AS ok
         FROM (SELECT 1 FROM player_progress p JOIN input i ON i.user_id = p.user_id
                WHERE p.version = i.expected_version FOR UPDATE OF p) locked
     ), claim AS (
       UPDATE games SET progress_applied_at = $2::timestamptz
        WHERE id = $1 AND status = 'finished' AND progress_applied_at IS NULL AND (SELECT ok FROM ok)
       RETURNING id
     ), upd AS (
       UPDATE player_progress pp
          SET xp = i.xp_after, version = pp.version + 1, updated_at = $2::timestamptz
         FROM input i
        WHERE pp.user_id = i.user_id AND pp.version = i.expected_version AND EXISTS (SELECT 1 FROM claim)
       RETURNING pp.user_id
     ), gp AS (
       UPDATE game_players g SET xp_gained = i.gained, xp_after = i.xp_after
         FROM input i
        WHERE g.game_id = $1 AND g.user_id = i.user_id AND EXISTS (SELECT 1 FROM claim)
       RETURNING g.user_id
     )
     SELECT (SELECT count(*) FROM claim)::int AS claimed`,
    [gameId, at, JSON.stringify(input)],
  );
  return Number(rows[0]?.claimed) === 1;
}

/** Finished games nobody awarded yet, oldest first. */
export async function listUnawarded(db: Db, limit: number) {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM games
      WHERE status = 'finished' AND progress_applied_at IS NULL
      ORDER BY finished_at NULLS FIRST, id
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/** A player's total XP; 0 when they have never been awarded any. */
export async function queryXp(db: Db, userId: string) {
  const rows = await db.query<{ xp: number }>(`SELECT xp FROM player_progress WHERE user_id = $1`, [userId]);
  return rows[0] ? Number(rows[0].xp) : 0;
}

const lifetimeRowSchema = z.object({
  games: z.number().int(),
  wins: z.number().int(),
  best_streak: z.number().int(),
  flawless: z.number().int(),
});

/** Lifetime numbers the achievement rules need, from finished games. A solo game is never a win or flawless. */
export async function queryLifetime(db: Db, userId: string): Promise<Lifetime> {
  const rows = await db.query(
    `WITH mine AS (
       SELECT gp.rank, gp.best_streak, gp.pairs, gp.moves,
              (SELECT count(*) FROM game_players o WHERE o.game_id = gp.game_id) AS seated
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'finished'
     )
     SELECT count(*)::int AS games,
            (count(*) FILTER (WHERE seated >= 2 AND rank = 1))::int AS wins,
            coalesce(max(best_streak), 0)::int AS best_streak,
            (count(*) FILTER (WHERE seated >= 2 AND pairs >= 3 AND moves = pairs))::int AS flawless
       FROM mine`,
    [userId],
  );
  const r = lifetimeRowSchema.parse(rows[0]);
  return { games: r.games, wins: r.wins, bestStreak: r.best_streak, flawless: r.flawless };
}

/** Records achievements; one already earned keeps its original `earned_at` and game. */
export async function grantAchievements(db: Db, userId: string, ids: string[], gameId: string, at: string) {
  await db.query(
    `INSERT INTO player_achievements (user_id, achievement_id, earned_at, game_id)
     SELECT $1, a, $4::timestamptz, $3::uuid FROM jsonb_array_elements_text($2::jsonb) AS a
     ON CONFLICT (user_id, achievement_id) DO NOTHING`,
    [userId, JSON.stringify(ids), gameId, at],
  );
}

/** What a player has earned, oldest first. */
export async function listAchievements(db: Db, userId: string) {
  const rows = await db.query<{ achievement_id: string; earned_at: Date | string }>(
    `SELECT achievement_id, earned_at FROM player_achievements
      WHERE user_id = $1 ORDER BY earned_at, achievement_id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.achievement_id, earnedAt: new Date(r.earned_at).toISOString() }));
}

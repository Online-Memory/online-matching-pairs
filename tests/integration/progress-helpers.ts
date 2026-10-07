import type { Db } from "@/server/db";

export async function progressRow(db: Db, userId: string) {
  const rows = await db.query<{ xp: number; version: number }>(
    `SELECT xp, version FROM player_progress WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function progressAppliedAt(db: Db, gameId: string) {
  const rows = await db.query<{ progress_applied_at: Date | null }>(
    `SELECT progress_applied_at FROM games WHERE id = $1`,
    [gameId],
  );
  return rows[0]!.progress_applied_at;
}

export async function gainRow(db: Db, gameId: string, userId: string) {
  const rows = await db.query<{ xp_gained: number | null; xp_after: number | null }>(
    `SELECT xp_gained, xp_after FROM game_players WHERE game_id = $1 AND user_id = $2`,
    [gameId, userId],
  );
  return rows[0];
}

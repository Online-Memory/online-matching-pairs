import { randomUUID } from "node:crypto";

import type { Db } from "@/server/db";

export type SeedPlayer = {
  userId: string | null;
  rank: number | null;
  pairs?: number;
  moves?: number;
  bestStreak?: number;
};

/** Inserts a game and its roster straight into the public tables. Returns the game id. */
export async function seedGame(
  db: Db,
  game: {
    code: string;
    status?: "lobby" | "playing" | "finished" | "abandoned";
    finishedAt?: string;
    players: SeedPlayer[];
  },
): Promise<string> {
  const id = randomUUID();
  const at = game.finishedAt ?? "2026-10-06T12:00:00Z";
  await db.query(
    `INSERT INTO games (id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, started_at, finished_at)
     VALUES ($1, $2, 'p0', '001', 8, 12, 20, $3, $4::timestamptz, $4::timestamptz)`,
    [id, game.code, game.status ?? "finished", at],
  );
  for (const [seat, player] of game.players.entries()) {
    await db.query(
      `INSERT INTO game_players (game_id, player_id, user_id, display_name, seat, moves, pairs, best_streak, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        `p${seat}`,
        player.userId,
        `Player ${seat}`,
        seat,
        player.moves ?? 10,
        player.pairs ?? 4,
        player.bestStreak ?? 1,
        player.rank,
      ],
    );
  }
  return id;
}

export async function seedProfile(db: Db, userId: string, handle: string, name: string) {
  await db.query(
    `INSERT INTO profiles (user_id, handle, display_name, last_seen_at) VALUES ($1, $2, $3, now())`,
    [userId, handle, name],
  );
}

export async function seedRating(db: Db, userId: string, rating: number, ratedGames = 10, wins = 0) {
  await db.query(`INSERT INTO player_ratings (user_id, rating, rated_games, wins) VALUES ($1, $2, $3, $4)`, [
    userId,
    rating,
    ratedGames,
    wins,
  ]);
}

export async function ratingRow(db: Db, userId: string) {
  const rows = await db.query<{ rating: number; rated_games: number; wins: number; version: number }>(
    `SELECT rating, rated_games, wins, version FROM player_ratings WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function ratedAt(db: Db, gameId: string) {
  const rows = await db.query<{ rated_at: Date | null }>(`SELECT rated_at FROM games WHERE id = $1`, [
    gameId,
  ]);
  return rows[0]!.rated_at;
}

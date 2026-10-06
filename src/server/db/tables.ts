import "server-only";

import { z } from "zod";

import type { PublicEvent } from "@/lib/protocol";
import { gameStateSchema, type GameState } from "@/server/engine";

import type { Db } from "./client";

const tableRowSchema = z.object({
  game_id: z.string(),
  version: z.number().int(),
  state: gameStateSchema,
  events: z.array(z.looseObject({ seq: z.number().int(), type: z.string(), at: z.number() })),
});

export type TableRecord = {
  gameId: string;
  version: number;
  state: GameState;
  events: PublicEvent[];
};

export type RosterEntry = {
  player_id: string;
  user_id: string | null;
  display_name: string;
  seat: number;
  moves: number;
  pairs: number;
  best_streak: number;
  rank: number | null;
};

const toTimestamp = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** Mirrored into `games` so the public directory never has to read a live board. */
const hostName = (s: GameState) => s.players.find((p) => p.id === s.hostId)?.name ?? "";
const seated = (s: GameState) => s.players.filter((p) => p.status !== "left").length;

/** Creates the public game row and its secret live state in one statement. */
export async function insertTable(
  db: Db,
  input: { gameId: string; state: GameState; events: PublicEvent[]; nextDueAt: number | null },
) {
  const { gameId, state } = input;
  await db.query(
    `WITH g AS (
       INSERT INTO games (id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, created_at,
                          is_public, player_count, host_name, table_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12, $13)
       RETURNING id
     )
     INSERT INTO table_state (game_id, version, state, events, next_due_at)
     SELECT id, 1, $14::jsonb, $15::jsonb, $16::timestamptz FROM g`,
    [
      gameId,
      state.code,
      state.hostId,
      state.theme,
      state.pairs,
      state.maxPlayers,
      state.turnSeconds,
      state.status,
      toTimestamp(state.createdAt),
      state.isPublic,
      seated(state),
      hostName(state),
      state.tableName,
      JSON.stringify(state),
      JSON.stringify(input.events),
      toTimestamp(input.nextDueAt),
    ],
  );
}

export async function loadTable(db: Db, code: string): Promise<TableRecord | null> {
  const rows = await db.query(
    `SELECT t.game_id, t.version, t.state, t.events
       FROM table_state t JOIN games g ON g.id = t.game_id
      WHERE g.code = $1`,
    [code],
  );
  if (rows.length === 0) return null;
  const row = tableRowSchema.parse(rows[0]);
  return { gameId: row.game_id, version: row.version, state: row.state, events: row.events as PublicEvent[] };
}

/**
 * Optimistic compare-and-set. Writes the new state only if nobody else saved since we read
 * `expectedVersion`, and in the same statement mirrors status, host, seat count and host name into `games` and, when given,
 * upserts the public roster into `game_players`. Returns false when another request won the race.
 */
export async function saveTable(
  db: Db,
  input: {
    gameId: string;
    expectedVersion: number;
    state: GameState;
    events: PublicEvent[];
    nextDueAt: number | null;
    roster: RosterEntry[] | null;
  },
): Promise<boolean> {
  const { state } = input;
  const rows = await db.query(
    `WITH s AS (
       UPDATE table_state
          SET state = $3::jsonb, events = $4::jsonb, next_due_at = $5::timestamptz,
              version = version + 1, updated_at = now()
        WHERE game_id = $1 AND version = $2
       RETURNING game_id
     ), g AS (
       UPDATE games
          SET status = $6, host_player_id = $7,
              started_at = $8::timestamptz, finished_at = $9::timestamptz,
              player_count = $11, host_name = $12
        WHERE id IN (SELECT game_id FROM s)
          AND (status, host_player_id, started_at, finished_at, player_count, host_name)
              IS DISTINCT FROM ($6::text, $7::text, $8::timestamptz, $9::timestamptz, $11::int, $12::text)
       RETURNING id
     ), p AS (
       INSERT INTO game_players (game_id, player_id, user_id, display_name, seat, moves, pairs, best_streak, rank)
       SELECT s.game_id, r.player_id, r.user_id, r.display_name, r.seat, r.moves, r.pairs, r.best_streak, r.rank
         FROM s, jsonb_to_recordset($10::jsonb) AS r(
           player_id text, user_id text, display_name text, seat int,
           moves int, pairs int, best_streak int, rank int)
       ON CONFLICT (game_id, player_id) DO UPDATE
          SET moves = excluded.moves, pairs = excluded.pairs,
              best_streak = excluded.best_streak, rank = excluded.rank
       RETURNING player_id
     )
     SELECT game_id FROM s`,
    [
      input.gameId,
      input.expectedVersion,
      JSON.stringify(state),
      JSON.stringify(input.events),
      toTimestamp(input.nextDueAt),
      state.status,
      state.hostId,
      toTimestamp(state.startedAt),
      toTimestamp(state.finishedAt),
      JSON.stringify(input.roster ?? []),
      seated(state),
      hostName(state),
    ],
  );
  return rows.length === 1;
}

/** Daily cleanup. Live tables untouched for a day are abandoned; finished state is dropped later. */
export async function cleanupTables(db: Db, now: number) {
  const day = 24 * 3_600_000;
  const abandoned = await db.query(
    `UPDATE games SET status = 'abandoned', finished_at = $1::timestamptz
      WHERE status IN ('lobby', 'playing')
        AND id IN (SELECT game_id FROM table_state WHERE updated_at < $2::timestamptz)
     RETURNING id`,
    [toTimestamp(now), toTimestamp(now - day)],
  );
  const deleted = await db.query(
    `DELETE FROM table_state t USING games g
      WHERE g.id = t.game_id AND g.status IN ('finished', 'abandoned') AND t.updated_at < $1::timestamptz
     RETURNING t.game_id`,
    [toTimestamp(now - day)],
  );
  // Lobbies that never started leave nothing worth keeping.
  const purged = await db.query(
    `DELETE FROM games g
      WHERE g.status = 'abandoned' AND g.started_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM table_state t WHERE t.game_id = g.id)
     RETURNING id`,
  );
  return { abandoned: abandoned.length, deletedStates: deleted.length, purgedGames: purged.length };
}

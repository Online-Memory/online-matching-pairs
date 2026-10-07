import "server-only";

import { z } from "zod";

import { MIN_REVEAL_MS, MISMATCH_LOCK_MS } from "@/lib/protocol";

/** Timings the rules depend on. Exported so tests can reason about them. */
export const RULES = {
  /** Mismatched pair stays face up this long unless the player dismisses it sooner. */
  mismatchLockMs: MISMATCH_LOCK_MS,
  /** A dismissal is ignored until the pair has been face up this long, so a 1s poll always sees it. */
  minRevealMs: MIN_REVEAL_MS,
  /** Consecutive turn timeouts before a player is marked away and skipped. */
  timeoutsBeforeAway: 3,
  /** Table is abandoned when nobody active is left for this long. */
  allAwayAbandonMs: 5 * 60_000,
  /** A lobby nobody starts is abandoned after this long without activity. */
  lobbyIdleMs: 30 * 60_000,
  /**
   * Minimum gap between two accepted flips from one player: faster than any human double tap, so it
   * only stops scripted bursts. (Rejected requests save nothing, so request-level flood protection
   * belongs in front of the app, e.g. a Vercel Firewall rate-limit rule.)
   */
  minActionGapMs: 40,
  /** Upper bound on deadlines processed in one tick, so a corrupt state can't spin forever. */
  maxTickIterations: 1_000,
  /** A pause ends by itself after this long. */
  pauseMs: 60_000,
  /** Pauses each player may start per game. */
  pausesPerPlayer: 5,
} as const;

const playerSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  seat: z.number().int(),
  status: z.enum(["active", "away", "left"]),
  moves: z.number().int(),
  pairs: z.number().int(),
  streak: z.number().int(),
  bestStreak: z.number().int(),
  timeouts: z.number().int(),
  lastActionAt: z.number(),
  pausesUsed: z.number().int().default(0),
});
export type PlayerState = z.infer<typeof playerSchema>;

const tileSchema = z.object({
  face: z.number().int(),
  state: z.enum(["hidden", "revealed", "matched"]),
  by: z.string().nullable(),
});
export type TileState = z.infer<typeof tileSchema>;

/**
 * The authoritative, secret table state. Lives only in `table_state.state` and in server memory;
 * clients get `toView(state, viewerId)` instead.
 */
export const gameStateSchema = z.object({
  code: z.string(),
  theme: z.string(),
  pairs: z.number().int(),
  maxPlayers: z.number().int(),
  turnSeconds: z.number().int(),
  /** Listed in the public directory. Fixed at creation; rows saved before this existed are private. */
  isPublic: z.boolean().default(false),
  /** Chosen by the host at creation. Rows saved before this existed have none. */
  tableName: z.string().default(""),
  status: z.enum(["lobby", "playing", "finished", "abandoned"]),
  hostId: z.string(),
  players: z.array(playerSchema),
  board: z.array(tileSchema),
  /** Tile ids currently face up in this turn (0-2). */
  revealed: z.array(z.number().int()),
  turn: z.object({ playerId: z.string(), deadline: z.number() }).nullable(),
  lockUntil: z.number().nullable(),
  /** When the current flip-back lock began. Dismissals measure the minimum reveal from here, not from lockUntil, which they move. */
  lockStartedAt: z.number().nullable().default(null),
  /** Set while paused. All other deadlines are frozen and shifted forward when it ends. */
  pause: z.object({ by: z.string(), startedAt: z.number(), until: z.number() }).nullable().default(null),
  lobbyExpiresAt: z.number().nullable(),
  abandonAt: z.number().nullable(),
  seq: z.number().int(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type GameState = z.infer<typeof gameStateSchema>;

export type Identity = { playerId: string; userId: string | null; name: string };

/** Uniform integer in [0, maxExclusive). Injected so tests can be deterministic. */
export type Rng = (maxExclusive: number) => number;

import { z } from "zod";

import { colourPrefsSchema, colourSchema } from "./colours";
import { PAIR_OPTIONS, THEME_IDS } from "./themes";

export * from "./colours";
export * from "./themes";

// ---------------------------------------------------------------------------
// Limits and codes
// ---------------------------------------------------------------------------

/** Table codes avoid look-alike characters (0/O, 1/I/L) so they can be read out loud. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const codeSchema = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`), "Invalid table code"));

/** The host's sign-in state fixes how many players can join: guests get small tables, signed-in hosts get 12. Joining is never gated. */
export const GUEST_MAX_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const maxPlayersFor = (signedIn: boolean) => (signedIn ? MAX_PLAYERS : GUEST_MAX_PLAYERS);
/** How long a mismatched pair stays face up unless its player flips it back sooner. */
export const MISMATCH_LOCK_MS = 5_000;
/** A dismissal is ignored until the pair has been face up this long, so a 1s poll always sees it. */
export const MIN_REVEAL_MS = 1_500;
export const TURN_SECONDS_OPTIONS = [10, 15, 20, 30, 45, 60] as const;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(24, "Name is too long")
  .regex(/^[^<>]*$/, "Name contains invalid characters");

export const tableNameSchema = z
  .string()
  .trim()
  .min(1, "Table name is required")
  .max(40, "Table name is too long")
  .regex(/^[^<>]*$/, "Table name contains invalid characters");

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const createTableRequestSchema = z.object({
  theme: z.enum(THEME_IDS),
  pairs: z
    .number()
    .int()
    .refine((n) => (PAIR_OPTIONS as readonly number[]).includes(n), "Unsupported board size"),
  // The fixed options are what the UI offers; 3s is allowed so timeout behaviour can be tested quickly.
  turnSeconds: z.number().int().min(3).max(120),
  // Optional so a client that doesn't send it gets a private table.
  isPublic: z.boolean().optional(),
  // Optional so an older client still creates a table; the list falls back to the host's name.
  tableName: tableNameSchema.optional(),
  name: displayNameSchema.optional(),
});
export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;

export const joinRequestSchema = z.object({
  name: displayNameSchema.optional(),
  colour: colourSchema.optional(),
});
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const chooseColourRequestSchema = z.object({ colour: colourSchema });
export type ChooseColourRequest = z.infer<typeof chooseColourRequestSchema>;

export const flipRequestSchema = z.object({ tileId: z.number().int().min(0).max(199) });
export type FlipRequest = z.infer<typeof flipRequestSchema>;

// ---------------------------------------------------------------------------
// Redacted views (the only shape of game state a client ever receives)
// ---------------------------------------------------------------------------

export type TableStatus = "lobby" | "playing" | "finished" | "abandoned";
export type PlayerStatus = "active" | "away" | "left" | "kicked";

/** Request header that carries the cheat codes switched on in the page URL (e.g. `?cheatmode=true`). */
export const CHEAT_HEADER = "x-cheat";
/** Every cheat code. Each is a query-string key that is switched on with `=true`. */
export const CHEAT_CODES = ["cheatmode"] as const;
export type CheatCode = (typeof CHEAT_CODES)[number];

/**
 * A face-down tile carries no face. Ids are board positions; faces were shuffled server-side.
 * The one exception is `peek`: only present when the viewer opted in with the `cheatmode` code.
 */
export type TileView =
  | { id: number; state: "hidden"; peek?: number }
  | { id: number; state: "revealed"; face: number }
  | { id: number; state: "matched"; face: number; by: string };

export type PlayerView = {
  id: string;
  name: string;
  seat: number;
  /** Index into PALETTE: the colour this player's tiles and seat use. */
  colour: number;
  status: PlayerStatus;
  isHost: boolean;
  isGuest: boolean;
  moves: number;
  pairs: number;
  /** Consecutive pairs matched right now; 0 after a miss or a timeout. Public. */
  streak: number;
  bestStreak: number;
  rank: number | null;
};

export type TableView = {
  code: string;
  theme: string;
  pairs: number;
  maxPlayers: number;
  turnSeconds: number;
  isPublic: boolean;
  /** Chosen by the host at creation; empty for tables created without one. */
  tableName: string;
  status: TableStatus;
  hostId: string;
  /** The viewer's player id, or null when they are only watching. */
  youId: string | null;
  players: PlayerView[];
  tiles: TileView[];
  /** `deadline` is server epoch ms (null while the turn is held for a kick vote); the client renders a countdown, the server decides expiry. */
  turn: { playerId: string; deadline: number | null; timedOut: boolean } | null;
  /** Mismatched tiles stay face up until this server time (or until the player dismisses them). */
  lockUntil: number | null;
  /** Set while the game is paused. `until` is when it resumes by itself; times are server epoch ms. */
  pause: { by: string; startedAt: number; until: number } | null;
  /** Whether the viewer can start a pause right now (seated, active, game running, budget left). */
  canPause: boolean;
  /** Set while a timed-out turn is held for a kick vote. The tally is counts plus `youVoted`; who voted is visible through `kick_vote` events. */
  kickVote: { targetId: string; votes: number; needed: number; youVoted: boolean } | null;
  /** Whether the viewer can cast a kick vote right now. */
  canVoteKick: boolean;
  seq: number;
};

// ---------------------------------------------------------------------------
// Public events. Never contain the face of a tile that is still hidden.
// ---------------------------------------------------------------------------

type EventBase = { seq: number; at: number };

export type PublicEvent = EventBase &
  (
    | { type: "player_joined"; playerId: string; name: string }
    | { type: "colour_changed"; playerId: string; colour: number }
    | { type: "player_left"; playerId: string }
    | { type: "started"; playerIds: string[] }
    | { type: "turn_changed"; playerId: string; deadline: number }
    | { type: "tile_revealed"; playerId: string; tileId: number; face: number }
    | { type: "pair_matched"; playerId: string; tileIds: [number, number] }
    | { type: "pair_missed"; playerId: string; tileIds: [number, number]; lockUntil: number }
    | { type: "tiles_hidden"; tileIds: number[] }
    | { type: "turn_timed_out"; playerId: string }
    | { type: "player_away"; playerId: string }
    | { type: "player_returned"; playerId: string }
    | { type: "host_changed"; playerId: string }
    | { type: "game_over"; scores: { playerId: string; pairs: number; rank: number }[] }
    | { type: "paused"; playerId: string; until: number }
    | { type: "resumed" }
    | { type: "kick_vote"; playerId: string }
    | { type: "player_kicked"; playerId: string }
    | { type: "abandoned" }
  );

export type PublicEventType = PublicEvent["type"];

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export type SnapshotResponse = {
  unchanged: false;
  serverNow: number;
  view: TableView;
  /** Events with seq > since, oldest first. Empty when `since` fell out of the server's ring. */
  events: PublicEvent[];
};

/**
 * `unchanged` still says who the server thinks is asking (`youId`, as in `TableView`), so a client
 * that was once given a view for the wrong identity notices and asks for a fresh one.
 */
export type PollResponse = { unchanged: true; serverNow: number; youId: string | null } | SnapshotResponse;

export type CreateTableResponse = { code: string };

/** One row of the public directory. Deliberately carries no board, turn or player list. */
export type PublicTableEntry = {
  code: string;
  /** Empty when the host didn't name the table. */
  tableName: string;
  theme: string;
  pairs: number;
  status: "lobby" | "playing";
  seats: { taken: number; max: number };
  hostName: string;
  /** ISO timestamp of table creation. */
  createdAt: string;
};
export type PublicTablesResponse = { tables: PublicTableEntry[] };

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "not_found",
  "table_full",
  "colour_taken",
  "already_started",
  "not_host",
  "not_your_turn",
  "not_a_player",
  "invalid_tile",
  "tile_not_hidden",
  "too_many_revealed",
  "locked",
  "paused",
  "pause_unavailable",
  "not_pauser",
  "kick_unavailable",
  "kicked",
  "not_playing",
  "rate_limited",
  "conflict",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorResponse = { error: { code: ErrorCode; message: string } };

export type HistoryEntry = {
  code: string;
  theme: string;
  pairs: number;
  finishedAt: string;
  you: {
    pairs: number;
    moves: number;
    bestStreak: number;
    rank: number | null;
    /** Null until the game is rated, and for games that are never rated. */
    ratingBefore: number | null;
    ratingAfter: number | null;
    /** XP this game paid and the player's XP afterwards. Null until awarded; absent from an older server. */
    xpGained?: number | null;
    xpAfter?: number | null;
    /** Ids of the achievements this game earned. Absent from an older server. */
    achievements?: string[];
  };
  players: { name: string; pairs: number; rank: number | null; isYou: boolean }[];
};

export type HistoryPage = { entries: HistoryEntry[]; total: number; page: number; pageSize: number };

export type LeaderboardEntry = {
  rank: number;
  /** Null for a player who has no profile yet. */
  handle: string | null;
  name: string;
  rating: number;
  ratedGames: number;
  wins: number;
  isYou: boolean;
};

export type LeaderboardScope = "global" | "friends";

export type LeaderboardResponse = {
  scope: LeaderboardScope;
  entries: LeaderboardEntry[];
  /** The viewer's own row (also when outside `entries`), or null for guests and unrated players. */
  me: LeaderboardEntry | null;
};

export type StatsResponse = {
  games: number;
  /** Finished games with 2 or more players; `wins` and `winRate` are over these. */
  versusGames: number;
  wins: number;
  winRate: number | null;
  bestStreak: number;
  /** Pairs per move, 0 to 1. */
  accuracy: number | null;
  rating: { value: number; ratedGames: number; rank: number } | null;
};

export type ProgressResponse = {
  xp: number;
  level: number;
  /** XP earned inside the current level, and how wide the level is. */
  xpIntoLevel: number;
  xpForNext: number;
  /** Everything earned so far. Absent from an older server. */
  achievements?: { id: string; earnedAt: string }[];
};

export type MeResponse = {
  authEnabled: boolean;
  user: { id: string; name: string; email: string | null; image: string | null } | null;
};

/** Handles are what people search for. Input is forgiving (`@Sonny ` -> `sonny`); storage is canonical. */
export const handleSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^@/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/, "Handles are 3-20 letters, numbers or underscores"));

export const friendRequestSchema = z.object({ handle: handleSchema });
export const setHandleSchema = z.object({ handle: handleSchema });
export const setColoursSchema = z.object({ colours: colourPrefsSchema });
export type ColoursResponse = { colours: number[] };
/** The heartbeat body. `tableCode` is the table the browser is seated at; null says "none", absent leaves it as is. */
export const presenceRequestSchema = z.object({ tableCode: codeSchema.nullable().optional() });
export const inviteRequestSchema = z.object({ userId: z.string().min(1).max(200) });

export type FriendEntry = {
  userId: string;
  handle: string;
  name: string;
  online: boolean;
  /** Online and reporting a lobby or game they are seated at. Self-reported by their browser, so only fit for UI. */
  inGame: boolean;
  lastSeenAt: string;
};
export type FriendRequestEntry = { userId: string; handle: string; name: string };
export type OutgoingRequestEntry = { userId: string; handle: string };
export type InviteEntry = {
  id: string;
  tableCode: string;
  fromName: string;
  fromHandle: string;
  expiresAt: string;
};

/** One poll for the whole friends panel. Carries no table state. */
export type FriendsResponse = {
  handle: string | null;
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  /** No display name: someone who merely sent a request shouldn't learn the target's real name. */
  outgoing: OutgoingRequestEntry[];
  invites: InviteEntry[];
};

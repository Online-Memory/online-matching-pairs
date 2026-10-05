import { z } from "zod";

import { PAIR_OPTIONS, THEME_IDS } from "./themes";

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
export const TURN_SECONDS_OPTIONS = [10, 15, 20, 30, 45, 60] as const;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(24, "Name is too long")
  .regex(/^[^<>]*$/, "Name contains invalid characters");

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
  name: displayNameSchema.optional(),
});
export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;

export const joinRequestSchema = z.object({ name: displayNameSchema.optional() });
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const flipRequestSchema = z.object({ tileId: z.number().int().min(0).max(199) });
export type FlipRequest = z.infer<typeof flipRequestSchema>;

// ---------------------------------------------------------------------------
// Redacted views (the only shape of game state a client ever receives)
// ---------------------------------------------------------------------------

export type TableStatus = "lobby" | "playing" | "finished" | "abandoned";
export type PlayerStatus = "active" | "away" | "left";

/** A face-down tile carries no face. Ids are board positions; faces were shuffled server-side. */
export type TileView =
  | { id: number; state: "hidden" }
  | { id: number; state: "revealed"; face: number }
  | { id: number; state: "matched"; face: number; by: string };

export type PlayerView = {
  id: string;
  name: string;
  seat: number;
  status: PlayerStatus;
  isHost: boolean;
  isGuest: boolean;
  moves: number;
  pairs: number;
  bestStreak: number;
  rank: number | null;
};

export type TableView = {
  code: string;
  theme: string;
  pairs: number;
  maxPlayers: number;
  turnSeconds: number;
  status: TableStatus;
  hostId: string;
  /** The viewer's player id, or null when they are only watching. */
  youId: string | null;
  players: PlayerView[];
  tiles: TileView[];
  /** Deadline is server epoch ms; the client renders a countdown, the server decides expiry. */
  turn: { playerId: string; deadline: number } | null;
  /** Mismatched tiles stay face up until this server time (or until the player dismisses them). */
  lockUntil: number | null;
  seq: number;
};

// ---------------------------------------------------------------------------
// Public events. Never contain the face of a tile that is still hidden.
// ---------------------------------------------------------------------------

type EventBase = { seq: number; at: number };

export type PublicEvent = EventBase &
  (
    | { type: "player_joined"; playerId: string; name: string }
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

export const ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "not_found",
  "table_full",
  "already_started",
  "not_host",
  "not_your_turn",
  "not_a_player",
  "invalid_tile",
  "tile_not_hidden",
  "too_many_revealed",
  "locked",
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
  you: { pairs: number; moves: number; bestStreak: number; rank: number | null };
  players: { name: string; pairs: number; rank: number | null; isYou: boolean }[];
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
export const inviteRequestSchema = z.object({ userId: z.string().min(1).max(200) });

export type FriendEntry = {
  userId: string;
  handle: string;
  name: string;
  online: boolean;
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

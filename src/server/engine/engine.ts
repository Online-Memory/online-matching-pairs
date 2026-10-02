import "server-only";

import type { ErrorCode, PublicEvent, TableView, TileView } from "@/lib/protocol";

import { RULES, type GameState, type Identity, type PlayerState, type Rng } from "./state";

export class EngineError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export type Action =
  | { type: "join"; identity: Identity }
  | { type: "start" }
  | { type: "flip"; tileId: number }
  | { type: "leave" };

export type EngineResult = { state: GameState; events: PublicEvent[] };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistributiveOmit<PublicEvent, "seq" | "at">;

/** Mutable working copy plus the events produced while changing it. */
class Draft {
  readonly state: GameState;
  readonly events: PublicEvent[] = [];

  constructor(state: GameState) {
    this.state = structuredClone(state);
  }

  emit(event: NewEvent, at: number) {
    this.state.seq += 1;
    this.events.push({ ...event, seq: this.state.seq, at } as PublicEvent);
  }

  result(): EngineResult {
    return { state: this.state, events: this.events };
  }
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type TableSettings = { theme: string; pairs: number; maxPlayers: number; turnSeconds: number };

export function createTable(code: string, settings: TableSettings, host: Identity, now: number): GameState {
  return {
    code,
    ...settings,
    status: "lobby",
    hostId: host.playerId,
    players: [newPlayer(host, 0, now)],
    board: [],
    revealed: [],
    turn: null,
    lockUntil: null,
    lobbyExpiresAt: now + RULES.lobbyIdleMs,
    abandonAt: null,
    seq: 0,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
  };
}

function newPlayer(identity: Identity, seat: number, now: number): PlayerState {
  return {
    id: identity.playerId,
    userId: identity.userId,
    name: identity.name,
    seat,
    status: "active",
    moves: 0,
    pairs: 0,
    streak: 0,
    bestStreak: 0,
    timeouts: 0,
    // Start in the past so the very first action is never rate limited.
    lastActionAt: now - RULES.minActionGapMs,
  };
}

/** Fisher-Yates over [1,1,2,2,...]: each face appears exactly twice, positions uniform. */
export function shuffleBoard(pairs: number, rng: Rng): number[] {
  const faces = Array.from({ length: pairs * 2 }, (_, i) => Math.floor(i / 2) + 1);
  for (let i = faces.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [faces[i], faces[j]] = [faces[j]!, faces[i]!];
  }
  return faces;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Applies one player action. Callers must `tick(state, now)` first so that elapsed deadlines
 * (timeouts, flip-back locks) are resolved before the action is validated.
 */
export function applyAction(
  state: GameState,
  actorId: string,
  action: Action,
  now: number,
  rng: Rng,
): EngineResult {
  const draft = new Draft(state);
  switch (action.type) {
    case "join":
      join(draft, action.identity, now);
      break;
    case "start":
      start(draft, actorId, now, rng);
      break;
    case "flip":
      flip(draft, actorId, action.tileId, now);
      break;
    case "leave":
      leave(draft, actorId, now);
      break;
  }
  return draft.result();
}

function join(draft: Draft, identity: Identity, now: number) {
  const s = draft.state;
  const existing = s.players.find((p) => p.id === identity.playerId);

  if (existing) {
    // Joining again is how an away player says "I'm back".
    if (s.status === "playing" && existing.status === "away") {
      existing.status = "active";
      existing.timeouts = 0;
      draft.emit({ type: "player_returned", playerId: existing.id }, now);
      if (!s.turn) {
        // Everyone was away: the returning player picks the game back up.
        s.abandonAt = null;
        beginTurn(draft, existing.id, now);
      }
    }
    return;
  }

  if (s.status !== "lobby") throw new EngineError("already_started", "This game has already started");
  if (s.players.length >= s.maxPlayers) throw new EngineError("table_full", "This table is full");
  if (!identity.name) throw new EngineError("bad_request", "Enter a name to join");

  const seat = Math.max(-1, ...s.players.map((p) => p.seat)) + 1;
  s.players.push(newPlayer(identity, seat, now));
  s.lobbyExpiresAt = now + RULES.lobbyIdleMs;
  draft.emit({ type: "player_joined", playerId: identity.playerId, name: identity.name }, now);
}

function start(draft: Draft, actorId: string, now: number, rng: Rng) {
  const s = draft.state;
  requirePlayer(s, actorId);
  if (s.status !== "lobby") throw new EngineError("already_started", "This game has already started");
  if (s.hostId !== actorId) throw new EngineError("not_host", "Only the host can start the game");

  s.board = shuffleBoard(s.pairs, rng).map((face) => ({ face, state: "hidden" as const, by: null }));
  s.status = "playing";
  s.startedAt = now;
  s.lobbyExpiresAt = null;
  s.players.sort((a, b) => a.seat - b.seat);
  draft.emit({ type: "started", playerIds: s.players.map((p) => p.id) }, now);
  beginTurn(draft, s.players[0]!.id, now);
}

function flip(draft: Draft, actorId: string, tileId: number, now: number) {
  const s = draft.state;
  if (s.status !== "playing") throw new EngineError("not_playing", "The game is not in progress");
  const player = requirePlayer(s, actorId);
  if (s.turn?.playerId !== actorId) throw new EngineError("not_your_turn", "It is not your turn");
  if (s.lockUntil !== null) throw new EngineError("locked", "Wait for the tiles to flip back");
  const tile = s.board[tileId];
  if (!tile) throw new EngineError("invalid_tile", "No such tile");
  if (tile.state !== "hidden") throw new EngineError("tile_not_hidden", "That tile is already face up");
  if (s.revealed.length >= 2) throw new EngineError("too_many_revealed", "Two tiles are already face up");
  if (now - player.lastActionAt < RULES.minActionGapMs) throw new EngineError("rate_limited", "Slow down");

  player.lastActionAt = now;
  player.timeouts = 0;
  tile.state = "revealed";
  s.revealed.push(tileId);
  draft.emit({ type: "tile_revealed", playerId: actorId, tileId, face: tile.face }, now);

  if (s.revealed.length < 2) return;

  const [firstId, secondId] = s.revealed as [number, number];
  const first = s.board[firstId]!;
  player.moves += 1;

  if (first.face === tile.face) {
    first.state = tile.state = "matched";
    first.by = tile.by = actorId;
    s.revealed = [];
    player.pairs += 1;
    player.streak += 1;
    player.bestStreak = Math.max(player.bestStreak, player.streak);
    draft.emit({ type: "pair_matched", playerId: actorId, tileIds: [firstId, secondId] }, now);

    if (s.board.every((t) => t.state === "matched")) finish(draft, now);
    else beginTurn(draft, actorId, now); // a match means go again, with a fresh timer
  } else {
    player.streak = 0;
    s.lockUntil = now + RULES.mismatchLockMs;
    draft.emit(
      { type: "pair_missed", playerId: actorId, tileIds: [firstId, secondId], lockUntil: s.lockUntil },
      now,
    );
    // The turn passes when the lock expires (see tick), once the tiles are face down again.
  }
}

function leave(draft: Draft, actorId: string, now: number) {
  const s = draft.state;
  const player = requirePlayer(s, actorId);

  if (s.status === "lobby") {
    s.players = s.players.filter((p) => p.id !== actorId);
    draft.emit({ type: "player_left", playerId: actorId }, now);
    if (s.players.length === 0) return abandon(draft, now);
    if (s.hostId === actorId) setHost(draft, s.players[0]!.id, now);
    return;
  }
  if (s.status !== "playing" || player.status === "left") return;

  player.status = "left";
  draft.emit({ type: "player_left", playerId: actorId }, now);

  if (!s.players.some((p) => p.status !== "left")) return abandon(draft, now);
  if (s.hostId === actorId) handOverHost(draft, now);

  if (s.turn?.playerId === actorId && s.lockUntil === null) {
    hideRevealed(draft, now);
    advanceTurn(draft, actorId, now);
  }
  // During a flip-back lock the lock expiry hides the tiles and advances past the leaver.
}

function requirePlayer(s: GameState, playerId: string): PlayerState {
  const player = s.players.find((p) => p.id === playerId);
  if (!player) throw new EngineError("not_a_player", "You are not seated at this table");
  return player;
}

// ---------------------------------------------------------------------------
// Turns, hosts and endings
// ---------------------------------------------------------------------------

function beginTurn(draft: Draft, playerId: string, at: number) {
  const deadline = at + draft.state.turnSeconds * 1000;
  draft.state.turn = { playerId, deadline };
  draft.emit({ type: "turn_changed", playerId, deadline }, at);
}

/** Next active player in seat order after `fromId` (wrapping, possibly `fromId` itself). */
function advanceTurn(draft: Draft, fromId: string, at: number) {
  const s = draft.state;
  const seated = [...s.players].sort((a, b) => a.seat - b.seat);
  const fromIndex = seated.findIndex((p) => p.id === fromId);
  for (let step = 1; step <= seated.length; step++) {
    const candidate = seated[(fromIndex + step) % seated.length]!;
    if (candidate.status === "active") return beginTurn(draft, candidate.id, at);
  }

  // Nobody active. If someone is merely away, give them a while to come back.
  s.turn = null;
  if (s.players.some((p) => p.status === "away")) s.abandonAt = at + RULES.allAwayAbandonMs;
  else abandon(draft, at);
}

function hideRevealed(draft: Draft, at: number) {
  const s = draft.state;
  if (s.revealed.length === 0) return;
  for (const id of s.revealed) s.board[id]!.state = "hidden";
  draft.emit({ type: "tiles_hidden", tileIds: s.revealed }, at);
  s.revealed = [];
}

function setHost(draft: Draft, playerId: string, at: number) {
  draft.state.hostId = playerId;
  draft.emit({ type: "host_changed", playerId }, at);
}

/** Next seat that is still active becomes host; if nobody is, the host stays as is. */
function handOverHost(draft: Draft, at: number) {
  const s = draft.state;
  const current = s.players.find((p) => p.id === s.hostId);
  const seated = [...s.players].sort((a, b) => a.seat - b.seat);
  const from = seated.findIndex((p) => p.id === current?.id);
  for (let step = 1; step < seated.length; step++) {
    const candidate = seated[(from + step) % seated.length]!;
    if (candidate.status === "active") return setHost(draft, candidate.id, at);
  }
}

function finish(draft: Draft, at: number) {
  const s = draft.state;
  s.status = "finished";
  s.turn = null;
  s.lockUntil = null;
  s.abandonAt = null;
  s.finishedAt = at;
  const ranks = computeRanks(s.players);
  draft.emit(
    {
      type: "game_over",
      scores: s.players.map((p) => ({ playerId: p.id, pairs: p.pairs, rank: ranks.get(p.id)! })),
    },
    at,
  );
}

function abandon(draft: Draft, at: number) {
  const s = draft.state;
  s.status = "abandoned";
  s.turn = null;
  s.lockUntil = null;
  s.abandonAt = null;
  s.lobbyExpiresAt = null;
  s.finishedAt = at;
  draft.emit({ type: "abandoned" }, at);
}

/** Competition ranking: equal pairs share a rank, e.g. 3, 3, 1 pairs -> ranks 1, 1, 3. */
export function computeRanks(players: readonly Pick<PlayerState, "id" | "pairs">[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const p of players) {
    ranks.set(p.id, 1 + players.filter((other) => other.pairs > p.pairs).length);
  }
  return ranks;
}

// ---------------------------------------------------------------------------
// Lazy timers
// ---------------------------------------------------------------------------

/** The earliest moment at which `tick` would change something, or null if nothing is scheduled. */
export function nextDueAt(s: GameState): number | null {
  if (s.status === "lobby") return s.lobbyExpiresAt;
  if (s.status !== "playing") return null;
  // While mismatched tiles are on show, the lock is the only thing that can happen next.
  if (s.lockUntil !== null) return s.lockUntil;
  const candidates = [s.turn?.deadline, s.abandonAt].filter((t): t is number => t != null);
  return candidates.length ? Math.min(...candidates) : null;
}

/**
 * Applies every deadline that has elapsed by `now`, in order and at the time each was due, so a
 * table nobody polled for a while catches up exactly as if a scheduler had been running.
 */
export function tick(state: GameState, now: number): EngineResult {
  const draft = new Draft(state);
  for (let i = 0; i < RULES.maxTickIterations; i++) {
    const due = nextDueAt(draft.state);
    if (due === null || due > now) break;
    applyDue(draft, due);
  }
  return draft.result();
}

function applyDue(draft: Draft, due: number) {
  const s = draft.state;

  if (s.status === "lobby") return abandon(draft, due);

  if (s.lockUntil !== null && s.lockUntil <= due) {
    s.lockUntil = null;
    hideRevealed(draft, due);
    return advanceTurn(draft, s.turn!.playerId, due);
  }

  if (s.abandonAt !== null && s.abandonAt <= due) return abandon(draft, due);

  if (s.turn && s.turn.deadline <= due) {
    const player = s.players.find((p) => p.id === s.turn!.playerId)!;
    draft.emit({ type: "turn_timed_out", playerId: player.id }, due);
    player.timeouts += 1;
    player.streak = 0;
    hideRevealed(draft, due);
    if (player.timeouts >= RULES.timeoutsBeforeAway) {
      player.status = "away";
      draft.emit({ type: "player_away", playerId: player.id }, due);
      if (s.hostId === player.id) handOverHost(draft, due);
    }
    advanceTurn(draft, player.id, due);
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** The only way game state leaves the server. Face-down tiles never carry their face. */
export function toView(s: GameState, viewerId: string | null): TableView {
  const ranks = s.status === "finished" ? computeRanks(s.players) : null;
  return {
    code: s.code,
    theme: s.theme,
    pairs: s.pairs,
    maxPlayers: s.maxPlayers,
    turnSeconds: s.turnSeconds,
    status: s.status,
    hostId: s.hostId,
    youId: viewerId !== null && s.players.some((p) => p.id === viewerId) ? viewerId : null,
    players: [...s.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        status: p.status,
        isHost: p.id === s.hostId,
        isGuest: p.userId === null,
        moves: p.moves,
        pairs: p.pairs,
        bestStreak: p.bestStreak,
        rank: ranks?.get(p.id) ?? null,
      })),
    tiles: s.board.map((t, id): TileView => {
      if (t.state === "hidden") return { id, state: "hidden" };
      if (t.state === "revealed") return { id, state: "revealed", face: t.face };
      return { id, state: "matched", face: t.face, by: t.by ?? "" };
    }),
    turn: s.turn ? { ...s.turn } : null,
    lockUntil: s.lockUntil,
    seq: s.seq,
  };
}

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  applyAction,
  createTable,
  EngineError,
  gameStateSchema,
  nextDueAt,
  RULES,
  seededRng,
  shuffleBoard,
  tick,
  toView,
  type Action,
  type GameState,
  type Identity,
} from ".";

const T0 = 1_700_000_000_000;
const id = (n: number): Identity => ({ playerId: `p${n}`, userId: n === 1 ? "user-1" : null, name: `P${n}` });

function act(state: GameState, actor: string, action: Action, now: number) {
  return applyAction(state, actor, action, now, seededRng(42)).state;
}

function lobby(players = 2, opts: Partial<{ pairs: number; turnSeconds: number; maxPlayers: number }> = {}) {
  let s = createTable(
    "ABC234",
    {
      theme: "001",
      pairs: opts.pairs ?? 8,
      maxPlayers: opts.maxPlayers ?? 4,
      turnSeconds: opts.turnSeconds ?? 20,
      isPublic: false,
      tableName: "Test table",
    },
    id(1),
    T0,
  );
  for (let n = 2; n <= players; n++) s = act(s, `p${n}`, { type: "join", identity: id(n) }, T0);
  return s;
}

function started(players = 2, opts: Parameters<typeof lobby>[1] = {}) {
  return act(lobby(players, opts), "p1", { type: "start" }, T0);
}

/** Two positions holding the same face, and two holding different faces (test-only peek at the secret). */
function pairOf(s: GameState, face?: number): [number, number] {
  const target = face ?? s.board.find((t) => t.state === "hidden")!.face;
  const ids = s.board.flatMap((t, i) => (t.face === target && t.state === "hidden" ? [i] : []));
  return [ids[0]!, ids[1]!];
}
function mismatch(s: GameState): [number, number] {
  const a = s.board.findIndex((t) => t.state === "hidden");
  const b = s.board.findIndex((t, i) => t.state === "hidden" && t.face !== s.board[a]!.face && i !== a);
  return [a, b];
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe(code);
    return;
  }
  throw new Error(`expected EngineError ${code}`);
}

describe("lobby", () => {
  it("seats players in join order up to maxPlayers", () => {
    const s = lobby(2, { maxPlayers: 2 });
    expect(s.players.map((p) => [p.id, p.seat])).toEqual([
      ["p1", 0],
      ["p2", 1],
    ]);
    expectError(() => act(s, "p3", { type: "join", identity: id(3) }, T0), "table_full");
  });

  it("join is idempotent for a seated player", () => {
    const s = lobby(2);
    const again = applyAction(s, "p2", { type: "join", identity: id(2) }, T0, seededRng(1));
    expect(again.events).toEqual([]);
    expect(again.state.players).toHaveLength(2);
  });

  it("only the host can start", () => {
    expectError(() => act(lobby(2), "p2", { type: "start" }, T0), "not_host");
  });

  it("host leaving the lobby hands the table to the next seat", () => {
    const s = act(lobby(3), "p1", { type: "leave" }, T0);
    expect(s.hostId).toBe("p2");
    expect(s.players.map((p) => p.id)).toEqual(["p2", "p3"]);
  });

  it("an idle lobby is abandoned after 30 minutes", () => {
    const s = lobby(1);
    expect(tick(s, T0 + RULES.lobbyIdleMs - 1).state.status).toBe("lobby");
    expect(tick(s, T0 + RULES.lobbyIdleMs).state.status).toBe("abandoned");
  });

  it("cannot join once the game started", () => {
    expectError(() => act(started(2), "p3", { type: "join", identity: id(3) }, T0), "already_started");
  });
});

describe("start", () => {
  it("deals every face exactly twice and gives the first seat the turn", () => {
    const s = started(2, { pairs: 12 });
    expect(s.board).toHaveLength(24);
    const counts = new Map<number, number>();
    for (const t of s.board) counts.set(t.face, (counts.get(t.face) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 20_000, timedOut: false, kickVotes: [] });
  });

  it("solo practice is allowed", () => {
    expect(started(1).status).toBe("playing");
  });
});

describe("flip", () => {
  it("a match scores and keeps the turn with a fresh timer", () => {
    let s = started(2);
    const [a, b] = pairOf(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
    expect(s.board[a]).toMatchObject({ state: "matched", by: "p1" });
    expect(s.players[0]).toMatchObject({ pairs: 1, moves: 1, streak: 1, bestStreak: 1 });
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 2000 + 20_000, timedOut: false, kickVotes: [] });
  });

  it("a miss locks the board, then flips back and passes the turn", () => {
    let s = started(2);
    const [a, b] = mismatch(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
    expect(s.lockUntil).toBe(T0 + 2000 + RULES.mismatchLockMs);
    expectError(() => act(s, "p1", { type: "flip", tileId: mismatch(s)[0] }, T0 + 2100), "locked");

    const { state, events } = tick(s, T0 + 2000 + RULES.mismatchLockMs);
    expect(events.map((e) => e.type)).toEqual(["tiles_hidden", "turn_changed"]);
    expect(state.board[a]!.state).toBe("hidden");
    expect(state.turn?.playerId).toBe("p2");
    expect(state.lockUntil).toBeNull();
  });

  it("the player who missed can dismiss the lock early; nobody else can, and it is a no-op otherwise", () => {
    let s = started(2);
    const [a, b] = mismatch(s);
    expect(act(s, "p1", { type: "dismiss" }, T0 + 500)).toEqual(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);

    const other = act(s, "p2", { type: "dismiss" }, T0 + 2000 + RULES.minRevealMs);
    expect(other.lockUntil).toBe(s.lockUntil);
    // Too soon to hide: the lock shrinks to the minimum reveal time, so the tiles still flip back early.
    const tooSoon = act(s, "p1", { type: "dismiss" }, T0 + 2100);
    expect(tooSoon.lockUntil).toBe(T0 + 2000 + RULES.minRevealMs);
    expect(tick(tooSoon, T0 + 2000 + RULES.minRevealMs).state.board[a]!.state).toBe("hidden");

    const at = T0 + 2000 + RULES.minRevealMs;
    const { state, events } = applyAction(s, "p1", { type: "dismiss" }, at, seededRng(42));
    expect(events.map((e) => e.type)).toEqual(["tiles_hidden", "turn_changed"]);
    expect(state.board[a]!.state).toBe("hidden");
    expect(state.lockUntil).toBeNull();
    expect(state.turn).toEqual({ playerId: "p2", deadline: at + 20_000, timedOut: false, kickVotes: [] });
  });

  it("repeated early dismissals cannot hide the pair before the minimum reveal time", () => {
    let s = started(2);
    const [a, b] = mismatch(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);

    s = act(s, "p1", { type: "dismiss" }, T0 + 2100);
    s = act(s, "p1", { type: "dismiss" }, T0 + 2200);
    expect(s.lockUntil).toBe(T0 + 2000 + RULES.minRevealMs);
    expect(s.board[a]!.state).toBe("revealed");
  });

  it("rejects out-of-turn, face-up and unknown tiles", () => {
    const s = started(2);
    expectError(() => act(s, "p2", { type: "flip", tileId: 0 }, T0 + 500), "not_your_turn");
    expectError(() => act(s, "p9", { type: "flip", tileId: 0 }, T0 + 500), "not_a_player");
    expectError(() => act(s, "p1", { type: "flip", tileId: 999 }, T0 + 500), "invalid_tile");
    const once = act(s, "p1", { type: "flip", tileId: 0 }, T0 + 500);
    expectError(() => act(once, "p1", { type: "flip", tileId: 0 }, T0 + 1000), "tile_not_hidden");
  });

  it("rate limits bursts from one player", () => {
    const s = act(started(1), "p1", { type: "flip", tileId: 0 }, T0 + 500);
    expectError(() => act(s, "p1", { type: "flip", tileId: 1 }, T0 + 520), "rate_limited");
  });

  it("finishes when every pair is matched, sharing ranks on ties", () => {
    let s = started(2, { pairs: 8 });
    let now = T0;
    // p1 matches 4 pairs, misses, then p2 matches the remaining 4.
    for (let i = 0; i < 4; i++) {
      for (const tileId of pairOf(s)) s = act(s, "p1", { type: "flip", tileId }, (now += 500));
    }
    for (const tileId of mismatch(s)) s = act(s, "p1", { type: "flip", tileId }, (now += 500));
    s = tick(s, (now += RULES.mismatchLockMs)).state;
    for (let i = 0; i < 4; i++) {
      for (const tileId of pairOf(s)) s = act(s, "p2", { type: "flip", tileId }, (now += 500));
    }
    expect(s.status).toBe("finished");
    expect(s.turn).toBeNull();
    const view = toView(s, "p1");
    expect(view.players.map((p) => p.rank)).toEqual([1, 1]);
    expect(nextDueAt(s)).toBeNull();
  });
});

describe("timeouts", () => {
  it("timeout after one flip keeps that tile face up and holds the turn on the same player", () => {
    let s = act(started(2), "p1", { type: "flip", tileId: 0 }, T0 + 1000);
    s = tick(s, T0 + 20_000).state;
    expect(s.board[0]!.state).toBe("revealed");
    expect(s.revealed).toEqual([0]);
    expect(s.turn).toEqual({ playerId: "p1", deadline: null, timedOut: true, kickVotes: [] });
    expect(s.abandonAt).toBe(T0 + 20_000 + RULES.allAwayAbandonMs);
  });

  it("nobody else can flip while the turn is held", () => {
    const s = tick(started(2), T0 + 20_000).state;
    expectError(() => act(s, "p2", { type: "flip", tileId: 0 }, T0 + 21_000), "not_your_turn");
  });

  it("a timed-out player who flips resumes the turn with a fresh clock", () => {
    let s = tick(started(2), T0 + 20_000).state;
    s = act(s, "p1", { type: "flip", tileId: 0 }, T0 + 25_000);
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 45_000, timedOut: false, kickVotes: [] });
    expect(s.abandonAt).toBeNull();
    expect(s.board[0]!.state).toBe("revealed");
  });

  it("the held tile stays face up until the player's second flip resolves the turn", () => {
    let s = act(started(2), "p1", { type: "flip", tileId: 0 }, T0 + 1000);
    s = tick(s, T0 + 20_000).state;
    const other = s.board.findIndex((t, i) => i !== 0 && t.face !== s.board[0]!.face);
    s = act(s, "p1", { type: "flip", tileId: other }, T0 + 25_000);
    expect(s.revealed).toEqual([0, other]);
    expect(s.lockUntil).not.toBeNull();
  });

  it("with nobody to vote, a timeout keeps the revealed tile and restarts the clock", () => {
    let s = act(started(1), "p1", { type: "flip", tileId: 0 }, T0 + 1000);
    s = tick(s, T0 + 20_000).state;
    expect(s.revealed).toEqual([0]);
    expect(s.board[0]!.state).toBe("revealed");
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 40_000, timedOut: false, kickVotes: [] });
  });

  it("a solo player's timeout just restarts their turn (nobody to vote)", () => {
    const s = tick(started(1), T0 + 20_000).state;
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 40_000, timedOut: false, kickVotes: [] });
    expect(s.abandonAt).toBeNull();
  });

  it("a solo player timing out repeatedly is marked away and the game is abandoned", () => {
    const { state, events } = tick(started(1), T0 + 24 * 3_600_000);
    expect(state.status).toBe("abandoned");
    expect(events.filter((e) => e.type === "turn_timed_out")).toHaveLength(RULES.timeoutsBeforeAway);
    expect(events.some((e) => e.type === "player_away")).toBe(true);
    expect(events.at(-1)!.type).toBe("abandoned");
    expect(events.at(-1)!.at).toBe(T0 + RULES.timeoutsBeforeAway * 20_000 + RULES.allAwayAbandonMs);
  });

  it("a flip resets the no-voter timeout counter", () => {
    let s = tick(started(1), T0 + 40_000).state; // two timeouts
    expect(s.players[0]!.timeouts).toBe(2);
    s = act(s, "p1", { type: "flip", tileId: 0 }, T0 + 41_000);
    expect(s.players[0]!.timeouts).toBe(0);
    s = tick(s, T0 + 41_000 + 20_000).state; // one more timeout is not enough to go away
    expect(s.players[0]!.status).toBe("active");
    expect(s.players[0]!.timeouts).toBe(1);
  });

  it("the last player left after the others quit gets the same away-then-abandon fallback", () => {
    const s = act(started(2), "p2", { type: "leave" }, T0 + 1000);
    const { state, events } = tick(s, T0 + 24 * 3_600_000);
    expect(state.status).toBe("abandoned");
    expect(events.some((e) => e.type === "player_away" && e.playerId === "p1")).toBe(true);
    expect(events.at(-1)!.type).toBe("abandoned");
  });

  it("a held turn nobody resolves ends in abandonment", () => {
    const { state, events } = tick(started(3, { turnSeconds: 10 }), T0 + 24 * 3_600_000);
    expect(state.status).toBe("abandoned");
    expect(events.filter((e) => e.type === "turn_timed_out")).toHaveLength(1);
    const abandoned = events.at(-1)!;
    expect(abandoned.type).toBe("abandoned");
    expect(abandoned.at).toBe(T0 + 10_000 + RULES.allAwayAbandonMs);
  });

  it("the held player leaving starts a fresh turn and clears the abandon timer", () => {
    let s = tick(started(3), T0 + 20_000).state;
    expect(s.abandonAt).not.toBeNull();
    s = act(s, "p1", { type: "leave" }, T0 + 21_000);
    expect(s.abandonAt).toBeNull();
    expect(s.turn?.playerId).toBe("p2");
    expect(s.turn?.timedOut).toBe(false);
  });

  it("tick is a no-op before anything is due", () => {
    const s = started(2);
    expect(tick(s, T0 + 1).events).toEqual([]);
  });
});

describe("leave", () => {
  it("keeps the leaver's score, passes their turn, and the last player continues solo", () => {
    let s = started(2);
    let now = T0;
    for (const tileId of pairOf(s)) s = act(s, "p1", { type: "flip", tileId }, (now += 500));
    s = act(s, "p1", { type: "leave" }, T0 + 5000);
    expect(s.players[0]).toMatchObject({ status: "left", pairs: 1 });
    expect(s.hostId).toBe("p2");
    expect(s.turn?.playerId).toBe("p2");
    s = tick(s, T0 + 5000 + 20_000).state;
    expect(s.turn?.playerId).toBe("p2");
  });

  it("everyone leaving abandons the table", () => {
    let s = started(2);
    s = act(s, "p1", { type: "leave" }, T0 + 1);
    s = act(s, "p2", { type: "leave" }, T0 + 2);
    expect(s.status).toBe("abandoned");
  });
});

describe("toView", () => {
  it("never exposes the face of a hidden tile", () => {
    const s = act(started(2, { pairs: 18 }), "p1", { type: "flip", tileId: 3 }, T0 + 500);
    const view = toView(s, "p2");
    for (const tile of view.tiles) {
      if (tile.id === 3) expect(tile).toEqual({ id: 3, state: "revealed", face: s.board[3]!.face });
      else expect(tile).toEqual({ id: tile.id, state: "hidden" });
    }
    expect(view.youId).toBe("p2");
    expect(toView(s, "stranger").youId).toBeNull();
  });

  it("only adds peek to hidden tiles when revealAll is asked for", () => {
    const s = act(started(2, { pairs: 18 }), "p1", { type: "flip", tileId: 3 }, T0 + 500);
    const view = toView(s, "p2", { revealAll: true });
    for (const tile of view.tiles) {
      if (tile.id === 3) expect(tile).toEqual({ id: 3, state: "revealed", face: s.board[3]!.face });
      else expect(tile).toEqual({ id: tile.id, state: "hidden", peek: s.board[tile.id]!.face });
    }
    expect(toView(s, "p2", {})).toEqual(toView(s, "p2"));
  });

  it("exposes the current streak to everyone, and a miss or a timeout resets it", () => {
    let s = started(2, { pairs: 18 });
    const [a, b] = pairOf(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
    const [c, d] = pairOf(s);
    s = act(s, "p1", { type: "flip", tileId: c }, T0 + 3000);
    s = act(s, "p1", { type: "flip", tileId: d }, T0 + 4000);
    // A stranger (not seated) sees it too: it is public, so a reload or a spectator stays correct.
    expect(toView(s, "stranger").players[0]).toMatchObject({ id: "p1", streak: 2, bestStreak: 2 });

    const [m, n] = mismatch(s);
    s = act(s, "p1", { type: "flip", tileId: m }, T0 + 5000);
    s = act(s, "p1", { type: "flip", tileId: n }, T0 + 6000);
    expect(toView(s, "p2").players[0]).toMatchObject({ streak: 0, bestStreak: 2 });
  });

  it("a turn timeout resets the streak in the view", () => {
    let s = started(2, { pairs: 18 });
    const [a, b] = pairOf(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 1000);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 2000);
    expect(toView(s, "p2").players[0]).toMatchObject({ streak: 1 });
    s = tick(s, T0 + 2000 + 20_000).state; // the fresh 20s turn timer runs out
    expect(toView(s, "p2").players[0]).toMatchObject({ streak: 0, bestStreak: 1 });
  });
});

// ---------------------------------------------------------------------------
// Property tests: random sequences of actions and clock jumps
// ---------------------------------------------------------------------------

const step = fc.oneof(
  fc.record({ kind: fc.constant("flip" as const), actor: fc.integer({ min: 1, max: 3 }), tile: fc.nat(40) }),
  fc.record({ kind: fc.constant("wait" as const), ms: fc.integer({ min: 0, max: 60_000 }) }),
  fc.record({ kind: fc.constant("leave" as const), actor: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant("join" as const), actor: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant("vote" as const), actor: fc.integer({ min: 1, max: 3 }) }),
);

type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;

function run(seed: number, steps: Step[]) {
  let s = applyAction(
    lobby(3, { pairs: 12, turnSeconds: 10 }),
    "p1",
    { type: "start" },
    T0,
    seededRng(seed),
  ).state;
  let now = T0;
  const history: GameState[] = [s];
  for (const st of steps) {
    now += st.kind === "wait" ? st.ms : 150;
    s = tick(s, now).state;
    try {
      if (st.kind === "flip") s = act(s, `p${st.actor}`, { type: "flip", tileId: st.tile }, now);
      if (st.kind === "leave") s = act(s, `p${st.actor}`, { type: "leave" }, now);
      if (st.kind === "join") s = act(s, `p${st.actor}`, { type: "join", identity: id(st.actor) }, now);
      if (st.kind === "vote") s = act(s, `p${st.actor}`, { type: "vote_kick" }, now);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
    history.push(s);
  }
  return history;
}

describe("invariants", () => {
  it("pairs are conserved, matches never revert, scores add up", () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(step, { maxLength: 120 }), (seed, steps) => {
        const history = run(seed, steps);
        const initialFaces = history[0]!.board.map((t) => t.face);
        for (let i = 0; i < history.length; i++) {
          const s = history[i]!;
          // Board contents never change, only their visibility.
          expect(s.board.map((t) => t.face)).toEqual(initialFaces);
          // Matched tiles come in pairs and stay matched.
          const matched = s.board.filter((t) => t.state === "matched");
          expect(matched.length % 2).toBe(0);
          expect(s.players.reduce((sum, p) => sum + p.pairs, 0)).toBe(matched.length / 2);
          if (i > 0) {
            history[i - 1]!.board.forEach((t, tileId) => {
              if (t.state === "matched") expect(s.board[tileId]!.state).toBe("matched");
            });
          }
          // At most two tiles face up, and only while playing.
          const revealed = s.board.filter((t) => t.state === "revealed").length;
          expect(revealed).toBeLessThanOrEqual(2);
          expect(revealed).toBe(s.revealed.length);
          if (s.status === "playing") expect(s.turn !== null || s.abandonAt !== null).toBe(true);
          if (s.status === "playing" && s.turn) {
            // Only active players hold the turn (a leaver keeps it until the flip-back lock expires),
            // and the clock is off exactly while the turn is held.
            if (s.lockUntil === null) {
              expect(s.players.find((p) => p.id === s.turn!.playerId)!.status).toBe("active");
            }
            expect(s.turn.deadline === null).toBe(s.turn.timedOut);
          }
          // Redacted view leaks no hidden faces.
          for (const tile of toView(s, "p1").tiles) {
            if (tile.state === "hidden") expect(Object.keys(tile).sort()).toEqual(["id", "state"]);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("shuffle is a permutation of the pair multiset", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 50 }), (seed, pairs) => {
        const faces = shuffleBoard(pairs, seededRng(seed));
        expect([...faces].sort((a, b) => a - b)).toEqual(
          Array.from({ length: pairs * 2 }, (_, i) => Math.floor(i / 2) + 1),
        );
      }),
    );
  });

  it("ticking in many small steps equals ticking once", () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.array(fc.integer({ min: 1, max: 30_000 }), { maxLength: 30 }),
        (seed, gaps) => {
          const s0 = applyAction(
            lobby(3, { turnSeconds: 10 }),
            "p1",
            { type: "start" },
            T0,
            seededRng(seed),
          ).state;
          let stepwise = s0;
          let now = T0;
          for (const gap of gaps) stepwise = tick(stepwise, (now += gap)).state;
          expect(tick(s0, now).state).toEqual(stepwise);
        },
      ),
    );
  });
});

describe("table visibility", () => {
  it("records visibility at creation, and old saved state without it parses as private", () => {
    const pub = createTable(
      "ABC234",
      { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: true, tableName: "Pub" },
      id(1),
      T0,
    );
    expect(pub.isPublic).toBe(true);
    expect(toView(pub, null).isPublic).toBe(true);

    const { isPublic: _omit, ...legacy } = pub;
    expect(gameStateSchema.parse(legacy).isPublic).toBe(false);
  });
});

describe("pause", () => {
  const MIN = RULES.pauseMs;

  it("can only be started by an active player in a running game, five times each", () => {
    expectError(() => act(lobby(2), "p1", { type: "pause" }, T0), "not_playing");
    const s = started(2);
    const paused = act(s, "p2", { type: "pause" }, T0 + 1_000);
    expect(paused.pause).toEqual({ by: "p2", startedAt: T0 + 1_000, until: T0 + 1_000 + MIN });
    expectError(() => act(paused, "p1", { type: "pause" }, T0 + 2_000), "paused");
  });

  it("gives each player five pauses, then refuses a sixth", () => {
    let s = started(2);
    let t = T0;
    for (let n = 1; n <= RULES.pausesPerPlayer; n++) {
      t += 1_000;
      s = act(s, "p2", { type: "pause" }, t);
      t += 1_000;
      s = act(s, "p2", { type: "resume" }, t);
    }
    expect(s.players.find((p) => p.id === "p2")!.pausesUsed).toBe(5);
    expectError(() => act(s, "p2", { type: "pause" }, t + 1_000), "pause_unavailable");
    // p1's budget is separate
    expect(act(s, "p1", { type: "pause" }, t + 1_000).pause?.by).toBe("p1");
  });

  it("lets only the player who paused resume early", () => {
    const paused = act(started(2), "p2", { type: "pause" }, T0 + 1_000);
    expectError(() => act(paused, "p1", { type: "resume" }, T0 + 2_000), "not_pauser");
    expect(act(paused, "p2", { type: "resume" }, T0 + 2_000).pause).toBeNull();
  });

  it("blocks flips, ignores dismiss, and schedules only its own end", () => {
    const s = act(started(2), "p1", { type: "pause" }, T0 + 1_000);
    expectError(() => act(s, "p1", { type: "flip", tileId: 0 }, T0 + 2_000), "paused");
    expect(act(s, "p1", { type: "dismiss" }, T0 + 2_000)).toEqual(s);
    expect(nextDueAt(s)).toBe(T0 + 1_000 + MIN);
  });

  it("shifts the turn deadline by the paused time when it auto-resumes", () => {
    const s = started(2, { turnSeconds: 20 });
    const deadline = s.turn!.deadline!; // T0 + 20_000
    const paused = act(s, "p2", { type: "pause" }, T0 + 5_000);
    const { state, events } = tick(paused, T0 + 5_000 + MIN + 10);
    expect(state.pause).toBeNull();
    expect(state.turn!.deadline).toBe(deadline + MIN);
    expect(state.turn!.playerId).toBe("p1");
    expect(events.map((e) => e.type)).toEqual(["resumed"]);
  });

  it("shifts by the shorter elapsed time on an early resume", () => {
    const s = started(2, { turnSeconds: 20 });
    const paused = act(s, "p1", { type: "pause" }, T0 + 5_000);
    const resumed = act(paused, "p1", { type: "resume" }, T0 + 15_000);
    expect(resumed.pause).toBeNull();
    expect(resumed.turn!.deadline).toBe(s.turn!.deadline! + 10_000);
  });

  it("never moves deadlines backwards when a resume's clock reads earlier than the pause's", () => {
    const s = started(2, { turnSeconds: 20 });
    const paused = act(s, "p1", { type: "pause" }, T0 + 5_000);
    const resumed = act(paused, "p1", { type: "resume" }, T0 + 4_990); // clock skew between instances
    expect(resumed.pause).toBeNull();
    expect(resumed.turn!.deadline).toBe(s.turn!.deadline);
  });

  it("gives a face-up mismatch its remaining lock time back", () => {
    let s = started(2);
    const [a, b] = mismatch(s);
    s = act(s, "p1", { type: "flip", tileId: a }, T0 + 100);
    s = act(s, "p1", { type: "flip", tileId: b }, T0 + 200);
    const lockUntil = s.lockUntil!;
    s = act(s, "p2", { type: "pause" }, T0 + 1_000);
    s = tick(s, T0 + 1_000 + MIN + 1).state;
    expect(s.lockUntil).toBe(lockUntil + MIN);
    expect(s.revealed).toHaveLength(2); // still face up, not yet flipped back
    expect(s.pause).toBeNull();
  });

  it("is a harmless no-op to resume when nothing is paused", () => {
    const s = started(2);
    expect(act(s, "p1", { type: "resume" }, T0 + 1_000)).toEqual(s);
  });

  it("ends when the player who paused leaves", () => {
    const s = act(started(3), "p3", { type: "pause" }, T0 + 1_000);
    const after = act(s, "p3", { type: "leave" }, T0 + 2_000);
    expect(after.pause).toBeNull();
    expect(after.status).toBe("playing");
  });

  it("gives the next player a full turn when someone leaves on their turn mid-pause", () => {
    const s = act(started(3, { turnSeconds: 20 }), "p3", { type: "pause" }, T0 + 1_000);
    const left = act(s, "p1", { type: "leave" }, T0 + 2_000); // p1 held the turn
    expect(left.turn!.playerId).toBe("p2");
    const resumed = act(left, "p3", { type: "resume" }, T0 + 11_000);
    expect(resumed.turn!.deadline).toBe(T0 + 11_000 + 20_000);
  });

  it("clears the pause when the game is abandoned", () => {
    const s = act(started(2), "p1", { type: "pause" }, T0 + 1_000);
    const a = act(s, "p1", { type: "leave" }, T0 + 2_000);
    const b = act(a, "p2", { type: "leave" }, T0 + 3_000);
    expect(b.status).toBe("abandoned");
    expect(b.pause).toBeNull();
  });

  it("is visible in the view, with canPause only for someone who can still pause", () => {
    const s = started(2);
    expect(toView(s, "p1")).toMatchObject({ pause: null, canPause: true });
    expect(toView(s, null).canPause).toBe(false);
    const paused = act(s, "p1", { type: "pause" }, T0 + 1_000);
    expect(toView(paused, "p2")).toMatchObject({
      pause: { by: "p1", startedAt: T0 + 1_000, until: T0 + 1_000 + MIN },
      canPause: false,
    });
    const resumed = act(paused, "p1", { type: "resume" }, T0 + 2_000);
    expect(toView(resumed, "p1").canPause).toBe(true); // 4 of 5 pauses left
    expect(toView(resumed, "p2").canPause).toBe(true);
    let spent = started(2);
    for (let n = 0; n < RULES.pausesPerPlayer; n++) {
      spent = act(spent, "p1", { type: "pause" }, T0 + 1_000 * (2 * n + 1));
      spent = act(spent, "p1", { type: "resume" }, T0 + 1_000 * (2 * n + 2));
    }
    expect(toView(spent, "p1").canPause).toBe(false); // budget spent
    expect(toView(spent, "p2").canPause).toBe(true);
  });

  it("parses state saved before pausing existed", () => {
    const { pause: _pause, ...old } = started(2);
    const legacy = { ...old, players: old.players.map(({ pausesUsed: _p, ...p }) => p) };
    const parsed = gameStateSchema.parse(legacy);
    expect(parsed.pause).toBeNull();
    expect(parsed.players.every((p) => p.pausesUsed === 0)).toBe(true);
  });
});

describe("kick vote", () => {
  const vote = (s: GameState, who: string, now = T0 + 21_000) => act(s, who, { type: "vote_kick" }, now);
  /** A game where p1's turn timed out and is being held. */
  const held = (players = 3) => tick(started(players), T0 + 20_000).state;

  it("a partial vote changes nothing but the tally", () => {
    const s = vote(held(), "p2");
    expect(s.players.find((p) => p.id === "p1")!.status).toBe("active");
    expect(s.turn).toEqual({ playerId: "p1", deadline: null, timedOut: true, kickVotes: ["p2"] });
  });

  it("a repeated vote is not counted twice", () => {
    const s = vote(vote(held(), "p2"), "p2");
    expect(s.turn!.kickVotes).toEqual(["p2"]);
  });

  it("a unanimous vote kicks the player and passes the turn", () => {
    const { state, events } = applyAction(
      vote(held(), "p2"),
      "p3",
      { type: "vote_kick" },
      T0 + 22_000,
      seededRng(1),
    );
    expect(state.players.find((p) => p.id === "p1")!.status).toBe("kicked");
    expect(state.turn).toEqual({ playerId: "p2", deadline: T0 + 42_000, timedOut: false, kickVotes: [] });
    expect(state.abandonAt).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["kick_vote", "player_kicked", "host_changed", "turn_changed"]);
  });

  it("the timed-out player cannot vote, and nobody can vote without a held turn", () => {
    expectError(() => vote(held(), "p1"), "kick_unavailable");
    expectError(() => vote(started(3), "p2"), "kick_unavailable");
    expectError(() => act(lobby(3), "p2", { type: "vote_kick" }, T0), "not_playing");
  });

  it("kicking the player turns their held tile face down", () => {
    let s = act(started(3), "p1", { type: "flip", tileId: 0 }, T0 + 1000);
    s = vote(vote(tick(s, T0 + 20_000).state, "p2"), "p3");
    expect(s.players.find((p) => p.id === "p1")!.status).toBe("kicked");
    expect(s.revealed).toEqual([]);
    expect(s.board[0]!.state).toBe("hidden");
  });

  it("the target flipping cancels the vote", () => {
    const s = act(vote(held(), "p2"), "p1", { type: "flip", tileId: 0 }, T0 + 25_000);
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 45_000, timedOut: false, kickVotes: [] });
  });

  it("a kicked player is a spectator: cannot flip, pause or vote, and rejoining changes nothing", () => {
    const s = vote(vote(held(), "p2"), "p3");
    expectError(() => act(s, "p1", { type: "flip", tileId: 0 }, T0 + 23_000), "kicked");
    expectError(() => act(s, "p1", { type: "pause" }, T0 + 23_000), "kicked");
    expectError(() => act(s, "p1", { type: "vote_kick" }, T0 + 23_000), "kicked");
    const rejoined = act(s, "p1", { type: "join", identity: id(1) }, T0 + 23_000);
    expect(rejoined.players.find((p) => p.id === "p1")!.status).toBe("kicked");
  });

  it("turn order skips the kicked player", () => {
    let s = vote(vote(held(), "p2"), "p3");
    let now = T0 + 23_000;
    for (const expected of ["p3", "p2"]) {
      const who = s.turn!.playerId;
      for (const tileId of mismatch(s)) s = act(s, who, { type: "flip", tileId }, (now += 200));
      now += RULES.mismatchLockMs;
      s = tick(s, now).state;
      expect(s.turn!.playerId).toBe(expected);
    }
  });

  it("kicked players keep their pairs and are ranked with everyone", () => {
    expect(toView(vote(vote(held(), "p2"), "p3"), "p2").players.map((p) => p.status)).toEqual([
      "kicked",
      "active",
      "active",
    ]);
  });

  it("hands the host over when the host is kicked", () => {
    const s = vote(vote(held(), "p2"), "p3");
    expect(s.hostId).toBe("p2");
  });

  it("completes the kick when the last holdout leaves", () => {
    const s = act(vote(held(), "p2"), "p3", { type: "leave" }, T0 + 22_000);
    expect(s.players.find((p) => p.id === "p1")!.status).toBe("kicked");
    expect(s.turn!.playerId).toBe("p2");
  });

  it("carries on with a fresh turn when every possible voter has left", () => {
    const s = act(held(2), "p2", { type: "leave" }, T0 + 21_000);
    expect(s.players.find((p) => p.id === "p1")!.status).toBe("active");
    expect(s.turn).toEqual({ playerId: "p1", deadline: T0 + 41_000, timedOut: false, kickVotes: [] });
    expect(s.abandonAt).toBeNull();
  });

  it("freezes the vote while paused, and a pause over a held turn leaves it held", () => {
    let s = act(held(), "p2", { type: "pause" }, T0 + 21_000);
    expectError(() => vote(s, "p3", T0 + 22_000), "paused");
    s = act(s, "p2", { type: "resume" }, T0 + 30_000);
    expect(s.turn).toMatchObject({ playerId: "p1", deadline: null, timedOut: true });
    expect(s.abandonAt).toBe(T0 + 20_000 + RULES.allAwayAbandonMs + 9_000);
  });

  it("toView exposes the tally and who may vote, never the voter list", () => {
    const s = vote(held(), "p2");
    const p2 = toView(s, "p2");
    expect(p2.kickVote).toEqual({ targetId: "p1", votes: 1, needed: 2, youVoted: true });
    expect(p2.canVoteKick).toBe(false);
    expect(toView(s, "p3").canVoteKick).toBe(true);
    expect(toView(s, "p1").canVoteKick).toBe(false);
    expect(toView(s, null).canVoteKick).toBe(false);
    expect(p2.turn).toEqual({ playerId: "p1", deadline: null, timedOut: true });
    expect(toView(started(3), "p2").kickVote).toBeNull();
  });

  it("still parses a state saved before the vote existed", () => {
    const old = structuredClone(started(2)) as unknown as {
      turn: Record<string, unknown>;
      players: Record<string, unknown>[];
    };
    delete old.turn.timedOut;
    delete old.turn.kickVotes;
    old.players[0]!.timeouts = 2;
    const parsed = gameStateSchema.parse(old);
    expect(parsed.turn).toMatchObject({ timedOut: false, kickVotes: [] });
  });
});

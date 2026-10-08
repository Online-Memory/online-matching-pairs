import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PollResponse, SnapshotResponse, TableView } from "@/lib/protocol";
import type { Db } from "@/server/db";
import { countHistory, listHistory } from "@/server/db/history";
import { cleanupTables, loadTable } from "@/server/db/tables";
import { seededRng, type Identity } from "@/server/engine";
import { ServiceError, TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const settings = {
  theme: "001",
  pairs: 8,
  maxPlayers: 4,
  turnSeconds: 20,
  isPublic: false,
  tableName: "Test table",
};
const alice: Identity = { playerId: "u_alice", userId: "alice", name: "Alice" };
const bob: Identity = { playerId: "g_bob", userId: null, name: "Bob" };
const carol: Identity = { playerId: "g_carol", userId: null, name: "Carol" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let now: number;
let service: TableService;
const clock = () => now;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  now = 1_700_000_000_000;
  service = new TableService(db, { clock, rng: seededRng(7) });
});

async function startedTable(players: Identity[] = [alice, bob]) {
  const { code } = await service.create(players[0]!, settings);
  for (const p of players.slice(1)) await service.act(code, p, { type: "join", identity: p }, -1);
  await service.act(code, players[0]!, { type: "start" }, -1);
  return code;
}

/** Test-only cheat: peeks at the secret board and matches every pair in order. */
async function playPerfectGame(code: string, player: Identity) {
  const board = (await loadTable(db, code))!.state.board;
  const byFace = new Map<number, number[]>();
  board.forEach((t, i) => byFace.set(t.face, [...(byFace.get(t.face) ?? []), i]));
  for (const tileIds of byFace.values()) {
    for (const tileId of tileIds) {
      now += 500;
      await service.act(code, player, { type: "flip", tileId }, -1);
    }
  }
}

describe("TableService", () => {
  it("creates a lobby, tells pollers when nothing changed, and replays missed events", async () => {
    const { code } = await service.create(alice, settings);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    const first = (await service.poll(code, alice.playerId, -1)) as SnapshotResponse;
    expect(first.view.status).toBe("lobby");
    expect(first.view.youId).toBe("u_alice");

    expect(await service.poll(code, alice.playerId, first.view.seq)).toEqual({
      unchanged: true,
      serverNow: now,
      youId: "u_alice",
    });
    // Someone who is not seated is told so, which is how a client with a stale identity finds out.
    expect(await service.poll(code, null, first.view.seq)).toMatchObject({ unchanged: true, youId: null });

    await service.act(code, bob, { type: "join", identity: bob }, -1);
    const next = (await service.poll(code, alice.playerId, first.view.seq)) as SnapshotResponse;
    expect(next.events.map((e) => e.type)).toEqual(["player_joined"]);
    expect(next.view.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("pauses, rejects flips, and resumes by itself on the next poll after the minute", async () => {
    const code = await startedTable();
    const before = (await service.poll(code, bob.playerId, -1)) as SnapshotResponse;
    const deadline = before.view.turn!.deadline;

    now += 2_000;
    const paused = await service.act(code, bob, { type: "pause" }, before.view.seq);
    expect(paused.view.pause).toMatchObject({ by: "g_bob" });
    await expect(service.act(code, alice, { type: "flip", tileId: 0 }, -1)).rejects.toMatchObject({
      code: "paused",
    });
    await expect(service.act(code, alice, { type: "resume" }, -1)).rejects.toMatchObject({
      code: "not_pauser",
    });

    now += 61_000;
    const after = (await service.poll(code, alice.playerId, paused.view.seq)) as SnapshotResponse;
    expect(after.view.pause).toBeNull();
    expect(after.view.turn!.deadline).toBe(deadline! + 60_000);
    expect(after.events.map((e) => e.type)).toEqual(["resumed"]);
  });

  it("returns snapshot only when the client is further behind than the event ring", async () => {
    const code = await startedTable();
    await playPerfectGame(code, alice);
    const res = (await service.poll(code, bob.playerId, 1)) as SnapshotResponse;
    expect(res.view.seq).toBeGreaterThan(31);
    expect(res.events).toEqual([]);
    const recent = (await service.poll(code, bob.playerId, res.view.seq - 2)) as SnapshotResponse;
    expect(recent.events.map((e) => e.type)).toEqual(["pair_matched", "game_over"]);
  });

  it("rejects unknown tables and out-of-turn flips with typed errors", async () => {
    await expect(service.poll("ZZZZZZ", null, -1)).rejects.toMatchObject({ code: "not_found" });
    const code = await startedTable();
    await expect(service.act(code, bob, { type: "flip", tileId: 0 }, -1)).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(service.act(code, bob, { type: "flip", tileId: 0 }, -1)).rejects.toMatchObject({
      code: "not_your_turn",
    });
  });

  it("seats 12 players at a 12-seat table and turns away the 13th", async () => {
    const guests: Identity[] = Array.from({ length: 12 }, (_, i) => ({
      playerId: `g_${i}`,
      userId: null,
      name: `Guest ${i}`,
    }));
    const { code } = await service.create(alice, { ...settings, maxPlayers: 12 });
    for (const g of guests.slice(1)) await service.act(code, g, { type: "join", identity: g }, -1);

    await expect(
      service.act(code, guests[0]!, { type: "join", identity: guests[0]! }, -1),
    ).rejects.toMatchObject({
      code: "table_full",
    });

    await service.act(code, alice, { type: "start" }, -1);
    const seats = await db.query<{ seat: number }>(
      "SELECT seat FROM game_players gp JOIN games g ON g.id = gp.game_id WHERE g.code = $1 ORDER BY seat",
      [code],
    );
    expect(seats.map((r) => r.seat)).toEqual([...Array(12).keys()]);
  });

  it("applies a missed turn deadline lazily on the next poll", async () => {
    const code = await startedTable();
    const before = (await service.poll(code, bob.playerId, -1)) as SnapshotResponse;
    expect(before.view.turn?.playerId).toBe("u_alice");

    now += settings.turnSeconds * 1000;
    const after = (await service.poll(code, bob.playerId, before.view.seq)) as SnapshotResponse;
    expect(after.events.map((e) => e.type)).toEqual(["turn_timed_out"]);
    expect(after.view.turn).toEqual({ playerId: "u_alice", deadline: null, timedOut: true });
  });

  it("holds a timed-out turn and kicks the player once everyone else votes", async () => {
    const code = await startedTable([alice, bob, carol]);
    now += settings.turnSeconds * 1000;
    const held = (await service.poll(code, bob.playerId, -1)) as SnapshotResponse;
    expect(held.view.turn).toEqual({ playerId: "u_alice", deadline: null, timedOut: true });
    expect(held.view.canVoteKick).toBe(true);

    await service.act(code, bob, { type: "vote_kick" }, held.view.seq);
    const done = await service.act(code, carol, { type: "vote_kick" }, held.view.seq);
    expect(done.events.map((e) => e.type)).toEqual([
      "kick_vote",
      "kick_vote",
      "player_kicked",
      "host_changed",
      "turn_changed",
    ]);
    expect(done.view.players.find((p) => p.id === "u_alice")?.status).toBe("kicked");
    expect(done.view.turn?.playerId).toBe("g_bob");
    await expect(service.act(code, alice, { type: "flip", tileId: 0 }, -1)).rejects.toMatchObject({
      code: "kicked",
    });
    // The kicked player's view of the table never contains a face-down tile's face.
    const asAlice = (await service.poll(code, alice.playerId, -1)) as SnapshotResponse;
    expect(
      asAlice.view.tiles.filter((t) => t.state === "hidden").every((t) => Object.keys(t).length === 2),
    ).toBe(true);
  });

  it("concurrent flips: compare-and-set makes the loser retry against the winner's state", async () => {
    const code = await startedTable();
    now += 1000;

    // Hold every save until both requests have read the same version, forcing a real conflict.
    let loads = 0;
    let releaseLoads!: () => void;
    const bothLoaded = new Promise<void>((resolve) => (releaseLoads = resolve));
    let conflicts = 0;
    const racingDb: Db = {
      query: async <Row>(text: string, params?: unknown[]) => {
        if (text.includes("FROM table_state t JOIN games")) {
          const rows = await db.query<Row>(text, params);
          if (++loads === 2) releaseLoads();
          return rows;
        }
        if (text.includes("UPDATE table_state")) {
          await bothLoaded;
          const rows = await db.query<Row>(text, params);
          if (rows.length === 0) conflicts++;
          return rows;
        }
        return db.query<Row>(text, params);
      },
    };
    const racing = new TableService(racingDb, { clock, rng: seededRng(7) });

    const results = await Promise.allSettled([
      racing.act(code, alice, { type: "flip", tileId: 0 }, -1),
      racing.act(code, alice, { type: "flip", tileId: 0 }, -1),
    ]);

    expect(conflicts).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "tile_not_hidden" });
    const record = (await loadTable(db, code))!;
    expect(record.state.revealed).toEqual([0]);
    expect(record.events.filter((e) => e.type === "tile_revealed")).toHaveLength(1);
  });

  it("writes the roster and final ranks when a game finishes, and shows it in history", async () => {
    const code = await startedTable();
    await playPerfectGame(code, alice);

    const final = (await service.poll(code, alice.playerId, -1)) as SnapshotResponse;
    expect(final.view.status).toBe("finished");
    expect(final.view.players.map((p) => [p.name, p.rank])).toEqual([
      ["Alice", 1],
      ["Bob", 2],
    ]);

    const [game] = await db.query<{ status: string; finished_at: Date | null }>(
      "SELECT status, finished_at FROM games WHERE code = $1",
      [code],
    );
    expect(game?.status).toBe("finished");
    expect(game?.finished_at).not.toBeNull();

    const history = await listHistory(db, "alice");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ code, you: { pairs: 8, moves: 8, rank: 1, bestStreak: 8 } });
    expect(history[0]!.players.map((p) => p.name)).toEqual(["Alice", "Bob"]);
    expect(await listHistory(db, "nobody")).toEqual([]);
    expect(await countHistory(db, "alice")).toBe(1);
    expect(await countHistory(db, "nobody")).toBe(0);
    expect(await listHistory(db, "alice", { limit: 10, offset: 1 })).toEqual([]);
  });

  it("daily cleanup abandons stale tables and drops their secret state", async () => {
    const code = await startedTable();
    await db.query("UPDATE table_state SET updated_at = now() - interval '2 days'");
    const result = await cleanupTables(db, Date.now());
    expect(result).toMatchObject({ abandoned: 1, deletedStates: 1 });
    expect(await loadTable(db, code)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Leak test: simulated clients play a full game using only what the server tells them.
// ---------------------------------------------------------------------------

type Client = { identity: Identity; since: number; view: TableView | null; memory: Map<number, number> };

describe("no hidden face ever leaves the server", () => {
  it("full 3-player game, every poll and action response scanned", async () => {
    const players = [alice, bob, carol];
    const { code } = await service.create(alice, { ...settings, pairs: 12 });
    const clients: Client[] = players.map((identity) => ({
      identity,
      since: -1,
      view: null,
      memory: new Map(),
    }));

    const everRevealed = new Set<number>();
    let responses = 0;

    /** Fails if a response names the face of any tile that has never been turned face up. */
    async function inspect(response: PollResponse | SnapshotResponse) {
      responses++;
      const board = (await loadTable(db, code))!.state.board;
      board.forEach((t, i) => t.state !== "hidden" && everRevealed.add(i));
      const json = JSON.stringify(response);
      expect(json).not.toContain('"board"');
      walk(response, (node) => {
        if (!("face" in node)) return;
        const tileId = (node.tileId ?? node.id) as number;
        expect(everRevealed.has(tileId), `face of never-revealed tile ${tileId} leaked`).toBe(true);
      });
      if (!response.unchanged) {
        for (const tile of response.view.tiles) {
          if (tile.state === "hidden") expect(Object.keys(tile).sort()).toEqual(["id", "state"]);
        }
      }
    }

    async function sync(client: Client, response: PollResponse | SnapshotResponse) {
      await inspect(response);
      if (response.unchanged) return;
      client.view = response.view;
      client.since = response.view.seq;
      for (const tile of response.view.tiles)
        if (tile.state !== "hidden") client.memory.set(tile.id, tile.face);
      for (const e of response.events) if (e.type === "tile_revealed") client.memory.set(e.tileId, e.face);
    }

    const act = async (client: Client, action: Parameters<TableService["act"]>[2]) =>
      sync(client, await service.act(code, client.identity, action, client.since));

    for (const client of clients.slice(1)) await act(client, { type: "join", identity: client.identity });
    await act(clients[0]!, { type: "start" });

    for (let round = 0; round < 500; round++) {
      now += 400;
      for (const client of clients)
        await sync(client, await service.poll(code, client.identity.playerId, client.since));
      const view = clients[0]!.view!;
      if (view.status !== "playing") break;
      if (view.lockUntil !== null || !view.turn) continue;

      const current = clients.find((c) => c.identity.playerId === view.turn!.playerId)!;
      const hidden = current.view!.tiles.filter((t) => t.state === "hidden").map((t) => t.id);
      const faceUp = current.view!.tiles.find((t) => t.state === "revealed");
      // A perfect-memory player: complete a known pair if possible, otherwise explore.
      const known = (tileId: number) => current.memory.get(tileId);
      let choice: number | undefined;
      if (faceUp && faceUp.state === "revealed") {
        choice =
          hidden.find((id) => known(id) === faceUp.face) ?? hidden.find((id) => known(id) === undefined);
      } else {
        const pair = hidden.find((a) =>
          hidden.some((b) => b !== a && known(a) !== undefined && known(a) === known(b)),
        );
        choice = pair ?? hidden.find((id) => known(id) === undefined) ?? hidden[0];
      }
      await act(current, { type: "flip", tileId: choice! });
    }

    const final = clients[0]!.view!;
    expect(final.status).toBe("finished");
    expect(final.players.reduce((n, p) => n + p.pairs, 0)).toBe(12);
    expect(responses).toBeGreaterThan(50);
  });
});

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(value)) value.forEach((v) => walk(v, visit));
  else if (value && typeof value === "object") {
    visit(value as Record<string, unknown>);
    Object.values(value).forEach((v) => walk(v, visit));
  }
}

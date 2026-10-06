import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  applyRatings,
  ensureRatingRows,
  listUnrated,
  loadGameToRate,
  loadRatings,
  loadRepeatCounts,
  markUnratable,
  type RatingUpdate,
} from "@/server/db/ratings";
import { pairKey } from "@/server/ratings/rating";

import { createTestDb } from "./db";
import { ratedAt, ratingRow, seedGame } from "./ratings-helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
});

const duelPlayers = [
  { userId: "alice", rank: 1 },
  { userId: "bob", rank: 2 },
];
const updates = (versionA = 0): RatingUpdate[] => [
  { userId: "alice", expectedVersion: versionA, ratingBefore: 1000, ratingAfter: 1016, won: true },
  { userId: "bob", expectedVersion: 0, ratingBefore: 1000, ratingAfter: 984, won: false },
];

describe("applyRatings", () => {
  it("changes nothing when a player's version is stale", async () => {
    const id = await seedGame(db, { code: "AAA234", players: duelPlayers });
    await ensureRatingRows(db, ["alice", "bob"]);

    expect(await applyRatings(db, id, "2026-10-06T13:00:00Z", updates(7))).toBe(false);
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1000, rated_games: 0, version: 0 });
    expect(await ratedAt(db, id)).toBeNull();
  });

  it("applies once: ratings, wins, version, per-game before/after and rated_at", async () => {
    const id = await seedGame(db, { code: "BBB234", players: duelPlayers });
    await ensureRatingRows(db, ["alice", "bob"]);

    expect(await applyRatings(db, id, "2026-10-06T13:00:00Z", updates())).toBe(true);
    expect(await ratingRow(db, "alice")).toEqual({ rating: 1016, rated_games: 1, wins: 1, version: 1 });
    expect(await ratingRow(db, "bob")).toEqual({ rating: 984, rated_games: 1, wins: 0, version: 1 });
    expect(await ratedAt(db, id)).not.toBeNull();
    const roster = await db.query(
      `SELECT user_id, rating_before, rating_after FROM game_players WHERE game_id = $1 ORDER BY user_id`,
      [id],
    );
    expect(roster).toEqual([
      { user_id: "alice", rating_before: 1000, rating_after: 1016 },
      { user_id: "bob", rating_before: 1000, rating_after: 984 },
    ]);

    // The same game again, even with fresh versions, is a no-op.
    const again = updates().map((u) => ({ ...u, expectedVersion: 1 }));
    expect(await applyRatings(db, id, "2026-10-06T13:05:00Z", again)).toBe(false);
    expect(await ratingRow(db, "alice")).toMatchObject({ rated_games: 1, version: 1 });
  });
});

describe("loadGameToRate", () => {
  it("returns null for unfinished, abandoned, missing and already rated games", async () => {
    const lobby = await seedGame(db, {
      code: "LOB234",
      status: "lobby",
      players: [{ userId: "a", rank: null }],
    });
    const gone = await seedGame(db, { code: "ABN234", status: "abandoned", players: duelPlayers });
    expect(await loadGameToRate(db, lobby)).toBeNull();
    expect(await loadGameToRate(db, gone)).toBeNull();
    expect(await loadGameToRate(db, "00000000-0000-0000-0000-000000000000")).toBeNull();

    const done = await seedGame(db, { code: "DON234", players: duelPlayers });
    await markUnratable(db, done, "2026-10-06T13:00:00Z");
    expect(await loadGameToRate(db, done)).toBeNull();
  });

  it("keeps only signed-in players that have a rank", async () => {
    const id = await seedGame(db, {
      code: "MIX234",
      players: [
        { userId: "alice", rank: 1 },
        { userId: null, rank: 2 },
        { userId: "bob", rank: 3 },
        { userId: "carol", rank: null },
      ],
    });
    const game = await loadGameToRate(db, id);
    expect(game?.participants).toEqual([
      { userId: "alice", rank: 1 },
      { userId: "bob", rank: 3 },
    ]);
  });

  it("returns an empty roster for a finished game of only guests", async () => {
    const id = await seedGame(db, {
      code: "GST234",
      players: [
        { userId: null, rank: 1 },
        { userId: null, rank: 2 },
      ],
    });
    expect(await loadGameToRate(db, id)).toEqual({ participants: [] });
  });
});

describe("loadRatings / ensureRatingRows", () => {
  it("creates missing rows once and reads them back", async () => {
    await ensureRatingRows(db, ["alice", "bob"]);
    await ensureRatingRows(db, ["alice", "carol"]);
    const map = await loadRatings(db, ["alice", "bob", "carol"]);
    expect([...map.keys()].sort()).toEqual(["alice", "bob", "carol"]);
    expect(map.get("alice")).toEqual({ rating: 1000, ratedGames: 0, version: 0 });
  });
});

describe("loadRepeatCounts", () => {
  it("counts only earlier rated games between the pair inside the window", async () => {
    const rate = async (id: string) => {
      await db.query(`UPDATE game_players SET rating_after = 1000 WHERE game_id = $1`, [id]);
    };
    const recent = await seedGame(db, {
      code: "REC234",
      finishedAt: "2026-10-06T10:00:00Z",
      players: duelPlayers,
    });
    const old = await seedGame(db, {
      code: "OLD234",
      finishedAt: "2026-10-04T10:00:00Z",
      players: duelPlayers,
    });
    await seedGame(db, { code: "UNR234", finishedAt: "2026-10-06T11:00:00Z", players: duelPlayers });
    const current = await seedGame(db, {
      code: "CUR234",
      finishedAt: "2026-10-06T12:00:00Z",
      players: duelPlayers,
    });
    await rate(recent);
    await rate(old);

    const counts = await loadRepeatCounts(db, current, ["alice", "bob"]);
    expect(counts.get(pairKey("alice", "bob"))).toBe(1);
  });
});

describe("listUnrated", () => {
  it("lists finished unrated games, oldest first, honouring the limit", async () => {
    const solo = [{ userId: "a", rank: 1 }];
    const late = await seedGame(db, { code: "LAT234", finishedAt: "2026-10-06T12:00:00Z", players: solo });
    const early = await seedGame(db, { code: "ERL234", finishedAt: "2026-10-06T08:00:00Z", players: solo });
    const rated = await seedGame(db, { code: "RTD234", finishedAt: "2026-10-06T07:00:00Z", players: solo });
    await markUnratable(db, rated, "2026-10-06T13:00:00Z");
    await seedGame(db, { code: "LOB234", status: "lobby", players: [{ userId: "a", rank: null }] });

    expect(await listUnrated(db, 10)).toEqual([early, late]);
    expect(await listUnrated(db, 1)).toEqual([early]);
  });
});

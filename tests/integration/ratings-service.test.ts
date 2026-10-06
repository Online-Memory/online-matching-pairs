import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/server/db";
import { listHistory } from "@/server/db/history";
import { RatingsService } from "@/server/ratings/service";
import { ServiceError } from "@/server/tables/service";

import { createTestDb } from "./db";
import { ratedAt, ratingRow, seedGame, seedProfile, seedRating } from "./ratings-helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
let friendMap: Record<string, string[]>;
let service: RatingsService;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  friendMap = {};
  service = new RatingsService(db, {
    clock: () => Date.parse("2026-10-06T13:00:00Z"),
    friends: { friendIds: async (id) => friendMap[id] ?? [] },
  });
});

const duel = (code: string, finishedAt = "2026-10-06T12:00:00Z") =>
  seedGame(db, {
    code,
    finishedAt,
    players: [
      { userId: "alice", rank: 1 },
      { userId: "bob", rank: 2 },
    ],
  });

describe("rateGame", () => {
  it("rates a duel once, with provisional K, and records before/after", async () => {
    const id = await duel("DUL234");
    expect(await service.rateGame(id)).toBe(true);
    expect(await ratingRow(db, "alice")).toEqual({ rating: 1024, rated_games: 1, wins: 1, version: 1 });
    expect(await ratingRow(db, "bob")).toEqual({ rating: 976, rated_games: 1, wins: 0, version: 1 });
    expect(await ratedAt(db, id)).not.toBeNull();

    expect(await service.rateGame(id)).toBe(false);
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1024, rated_games: 1 });
  });

  it("ignores guests and games with fewer than two signed-in players, and does not rescan them", async () => {
    const soloVsGuest = await seedGame(db, {
      code: "GST234",
      players: [
        { userId: "alice", rank: 1 },
        { userId: null, rank: 2 },
      ],
    });
    expect(await service.rateGame(soloVsGuest)).toBe(false);
    expect(await ratingRow(db, "alice")).toBeUndefined();
    expect(await ratedAt(db, soloVsGuest)).not.toBeNull();
    expect(await service.sweepUnrated(10)).toEqual({ rated: 0 });
  });

  it("rates only the signed-in players of a mixed table", async () => {
    const id = await seedGame(db, {
      code: "MIX234",
      players: [
        { userId: "alice", rank: 1 },
        { userId: null, rank: 2 },
        { userId: "bob", rank: 3 },
      ],
    });
    expect(await service.rateGame(id)).toBe(true);
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1024 });
    expect(await ratingRow(db, "bob")).toMatchObject({ rating: 976 });
  });

  it("never rates an abandoned game", async () => {
    const id = await seedGame(db, {
      code: "ABN234",
      status: "abandoned",
      players: [
        { userId: "alice", rank: 1 },
        { userId: "bob", rank: 2 },
      ],
    });
    expect(await service.rateGame(id)).toBe(false);
    expect(await ratedAt(db, id)).toBeNull();
  });

  it("pays less for a rematch within 24 hours", async () => {
    await service.rateGame(await duel("ONE234", "2026-10-06T10:00:00Z"));
    await service.rateGame(await duel("TWO234", "2026-10-06T11:00:00Z"));
    // Second game: both provisional (K 48), alice 1024 v bob 976, weight 0.75 -> alice +16 (not +21).
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1040, rated_games: 2 });
    expect(await ratingRow(db, "bob")).toMatchObject({ rating: 960 });
  });

  it("retries when a player's version moves between read and write", async () => {
    const id = await duel("RAC234");
    let bumped = false;
    const racing: Db = {
      query: (async (text: string, params?: unknown[]) => {
        if (!bumped && text.includes("FOR UPDATE")) {
          bumped = true;
          await db.query(`UPDATE player_ratings SET version = version + 1 WHERE user_id = 'alice'`);
        }
        return db.query(text, params);
      }) as Db["query"],
    };
    const racer = new RatingsService(racing, { friends: { friendIds: async () => [] } });
    expect(await racer.rateGame(id)).toBe(true);
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1024, rated_games: 1, version: 2 });
  });
});

describe("rateFinishedTable / sweepUnrated", () => {
  it("rates by table code and ignores an unknown code", async () => {
    await duel("COD234");
    await service.rateFinishedTable("COD234");
    await service.rateFinishedTable("NOP234");
    expect(await ratingRow(db, "alice")).toMatchObject({ rated_games: 1 });
  });

  it("sweeps oldest first up to the limit", async () => {
    const late = await duel("LAT234", "2026-10-06T12:00:00Z");
    const early = await duel("ERL234", "2026-10-06T08:00:00Z");
    const mid = await duel("MID234", "2026-10-06T10:00:00Z");
    expect(await service.sweepUnrated(2)).toEqual({ rated: 2 });
    expect(await ratedAt(db, early)).not.toBeNull();
    expect(await ratedAt(db, mid)).not.toBeNull();
    expect(await ratedAt(db, late)).toBeNull();
    expect(await service.sweepUnrated(2)).toEqual({ rated: 1 });
  });
});

describe("leaderboard", () => {
  beforeEach(async () => {
    await seedRating(db, "alice", 1200, 1);
    await seedRating(db, "bob", 1100, 1);
    await seedRating(db, "carol", 1000, 1);
    await seedProfile(db, "alice", "alice", "Alice");
    await seedProfile(db, "bob", "bob", "Bob");
  });

  it("includes a player after a single rated game, in rating order, without user ids", async () => {
    const board = await service.leaderboard("global", null);
    expect(board.entries.map((e) => [e.rank, e.name, e.rating])).toEqual([
      [1, "Alice", 1200],
      [2, "Bob", 1100],
      [3, "Player", 1000],
    ]);
    expect(board.entries[2]).toMatchObject({ handle: null });
    expect(board.me).toBeNull();
    expect(JSON.stringify(board)).not.toContain("userId");
    expect(JSON.stringify(board)).not.toContain("user_id");
  });

  it("returns the viewer's own row even outside the limit", async () => {
    const board = await service.leaderboard("global", "carol", 2);
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Bob"]);
    expect(board.me).toMatchObject({ rank: 3, isYou: true, rating: 1000 });
  });

  it("limits the friends scope to the viewer and their friends", async () => {
    friendMap = { alice: ["carol"] };
    const board = await service.leaderboard("friends", "alice");
    expect(board.entries.map((e) => e.name)).toEqual(["Alice", "Player"]);
    expect(board.entries[0]).toMatchObject({ rank: 1, isYou: true });
  });

  it("refuses the friends scope to a guest", async () => {
    await expect(service.leaderboard("friends", null)).rejects.toSatisfy(
      (e) => e instanceof ServiceError && e.code === "unauthorized",
    );
  });
});

describe("statsFor", () => {
  it("summarises finished games and survives a player with none", async () => {
    expect(await service.statsFor("nobody")).toEqual({
      games: 0,
      versusGames: 0,
      wins: 0,
      winRate: null,
      bestStreak: 0,
      accuracy: null,
      rating: null,
    });

    await seedGame(db, {
      code: "SOL234",
      players: [{ userId: "alice", rank: 1, pairs: 8, moves: 16, bestStreak: 1 }],
    });
    await seedGame(db, {
      code: "WIN234",
      players: [
        { userId: "alice", rank: 1, pairs: 5, moves: 10, bestStreak: 3 },
        { userId: "bob", rank: 2 },
      ],
    });
    await seedGame(db, {
      code: "LOS234",
      players: [
        { userId: "alice", rank: 2, pairs: 3, moves: 12, bestStreak: 2 },
        { userId: "bob", rank: 1 },
      ],
    });
    await seedGame(db, {
      code: "ABN234",
      status: "abandoned",
      players: [
        { userId: "alice", rank: null },
        { userId: "bob", rank: null },
      ],
    });
    await seedRating(db, "alice", 1100, 2, 1);
    await seedRating(db, "bob", 1200, 2, 1);

    const stats = await service.statsFor("alice");
    expect(stats).toMatchObject({ games: 3, versusGames: 2, wins: 1, winRate: 0.5, bestStreak: 3 });
    expect(stats.accuracy).toBeCloseTo(16 / 38);
    expect(stats.rating).toEqual({ value: 1100, ratedGames: 2, rank: 2 });
  });
});

describe("history", () => {
  it("carries the rating change of a rated game, and null for an unrated one", async () => {
    await service.rateGame(await duel("HIS234"));
    await seedGame(db, {
      code: "UNR234",
      finishedAt: "2026-10-06T12:30:00Z",
      players: [
        { userId: "alice", rank: 1 },
        { userId: null, rank: 2 },
      ],
    });

    const history = await listHistory(db, "alice");
    const rated = history.find((h) => h.code === "HIS234")!;
    const unrated = history.find((h) => h.code === "UNR234")!;
    expect(rated.you).toMatchObject({ ratingBefore: 1000, ratingAfter: 1024 });
    expect(unrated.you).toMatchObject({ ratingBefore: null, ratingAfter: null });
  });
});

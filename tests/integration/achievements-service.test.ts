import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listHistory } from "@/server/db/history";
import { ProgressService } from "@/server/progress/service";

import { createTestDb } from "./db";
import { seedGame } from "./ratings-helpers";

let db: Awaited<ReturnType<typeof createTestDb>>;
let service: ProgressService;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  service = new ProgressService(db, { clock: () => Date.parse("2026-10-07T13:00:00Z") });
});

/** Sorted: achievements earned in the same game share `earned_at`, so the stored order is alphabetical. */
const earned = async (userId: string) =>
  ((await service.progressFor(userId)).achievements?.map((a) => a.id) ?? []).sort();

describe("achievements", () => {
  it("grants first_game and first_win for a first won duel, and records the game", async () => {
    const id = await seedGame(db, {
      code: "DUL234",
      players: [
        { userId: "alice", rank: 1, pairs: 5, moves: 9, bestStreak: 2 },
        { userId: "bob", rank: 2, pairs: 3, moves: 9, bestStreak: 1 },
      ],
    });
    await service.awardGame(id);
    expect(await earned("alice")).toEqual(["first_game", "first_win"]);
    expect(await earned("bob")).toEqual(["first_game"]);
    const rows = await db.query<{ game_id: string }>(
      `SELECT game_id FROM player_achievements WHERE user_id = 'alice' LIMIT 1`,
    );
    expect(rows[0]!.game_id).toBe(id);
  });

  it("grants flawless and streak achievements from the game's numbers", async () => {
    const id = await seedGame(db, {
      code: "FLW234",
      players: [
        { userId: "alice", rank: 1, pairs: 8, moves: 8, bestStreak: 8 },
        { userId: "bob", rank: 2, pairs: 0, moves: 4, bestStreak: 0 },
      ],
    });
    await service.awardGame(id);
    expect(await earned("alice")).toEqual(["first_game", "first_win", "flawless", "streak_5", "streak_8"]);
  });

  it("does not give a solo game first_win or flawless", async () => {
    const id = await seedGame(db, {
      code: "SOL234",
      players: [{ userId: "alice", rank: 1, pairs: 8, moves: 8, bestStreak: 8 }],
    });
    await service.awardGame(id);
    expect(await earned("alice")).toEqual(["first_game", "streak_5", "streak_8"]);
  });

  it("grants nothing to guests, and a game with a guest still counts as versus for the signed-in player", async () => {
    const id = await seedGame(db, {
      code: "GST234",
      players: [
        { userId: "alice", rank: 1, pairs: 5, moves: 9, bestStreak: 1 },
        { userId: null, rank: 2, pairs: 3, moves: 9, bestStreak: 1 },
      ],
    });
    await service.awardGame(id);
    expect(await earned("alice")).toEqual(["first_game", "first_win"]);
    expect(await db.query(`SELECT 1 FROM player_achievements WHERE user_id IS NULL`)).toHaveLength(0);
  });

  it("is idempotent: a later game never duplicates or rewrites an earned achievement", async () => {
    const first = await seedGame(db, {
      code: "ONE234",
      finishedAt: "2026-10-07T11:00:00Z",
      players: [
        { userId: "alice", rank: 1, pairs: 5, moves: 9 },
        { userId: "bob", rank: 2, pairs: 3, moves: 9 },
      ],
    });
    await service.awardGame(first);
    await service.awardGame(
      await seedGame(db, {
        code: "TWO234",
        finishedAt: "2026-10-07T12:00:00Z",
        players: [
          { userId: "alice", rank: 1, pairs: 5, moves: 9 },
          { userId: "bob", rank: 2, pairs: 3, moves: 9 },
        ],
      }),
    );
    const rows = await db.query<{ achievement_id: string; game_id: string }>(
      `SELECT achievement_id, game_id FROM player_achievements WHERE user_id = 'alice' ORDER BY achievement_id`,
    );
    expect(rows.map((r) => r.achievement_id)).toEqual(["first_game", "first_win"]);
    expect(rows.every((r) => r.game_id === first)).toBe(true);
  });

  it("repairs a missed award at the player's next game", async () => {
    // A game whose achievements were never granted (the grant step failed after the claim).
    await service.awardGame(
      await seedGame(db, {
        code: "MIS234",
        finishedAt: "2026-10-07T11:00:00Z",
        players: [
          { userId: "alice", rank: 1, pairs: 5, moves: 9 },
          { userId: "bob", rank: 2, pairs: 3, moves: 9 },
        ],
      }),
    );
    await db.query(`DELETE FROM player_achievements WHERE user_id = 'alice'`);
    expect(await earned("alice")).toEqual([]);
    await service.awardGame(
      await seedGame(db, {
        code: "NXT234",
        finishedAt: "2026-10-07T12:00:00Z",
        players: [
          { userId: "alice", rank: 2, pairs: 3, moves: 9 },
          { userId: "bob", rank: 1, pairs: 5, moves: 9 },
        ],
      }),
    );
    expect(await earned("alice")).toEqual(["first_game", "first_win"]);
  });

  it("lists the achievements earned in a game on that game's history entry", async () => {
    await service.awardGame(
      await seedGame(db, {
        code: "HIS234",
        players: [
          { userId: "alice", rank: 1, pairs: 5, moves: 9 },
          { userId: "bob", rank: 2, pairs: 3, moves: 9 },
        ],
      }),
    );
    const you = (await listHistory(db, "alice"))[0]!.you;
    expect([...(you.achievements ?? [])].sort()).toEqual(["first_game", "first_win"]);
  });

  it("reports an empty list for a player with none", async () => {
    expect((await service.progressFor("nobody")).achievements).toEqual([]);
  });
});

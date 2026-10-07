import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { listHistory } from "@/server/db/history";
import { ProgressService } from "@/server/progress/service";

import { createTestDb } from "./db";
import { gainRow, progressAppliedAt, progressRow } from "./progress-helpers";
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

const duel = (code: string, finishedAt = "2026-10-07T12:00:00Z") =>
  seedGame(db, {
    code,
    finishedAt,
    players: [
      { userId: "alice", rank: 1, pairs: 6, bestStreak: 4 },
      { userId: "bob", rank: 2, pairs: 2, bestStreak: 1 },
    ],
  });

describe("awardGame", () => {
  it("awards a duel once and records each player's gain", async () => {
    const id = await duel("DUL234");
    expect(await service.awardGame(id)).toBe(true);
    expect(await progressRow(db, "alice")).toEqual({ xp: 125, version: 1 }); // 60 + 15 + 50
    expect(await progressRow(db, "bob")).toEqual({ xp: 50, version: 1 }); // 20 + 0 + 30
    expect(await gainRow(db, id, "alice")).toEqual({ xp_gained: 125, xp_after: 125 });
    expect(await progressAppliedAt(db, id)).not.toBeNull();

    expect(await service.awardGame(id)).toBe(false);
    expect(await progressRow(db, "alice")).toEqual({ xp: 125, version: 1 });
  });

  it("counts a game once when two workers award it at the same time", async () => {
    const id = await duel("RAC234");
    const results = await Promise.all([service.awardGame(id), service.awardGame(id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await progressRow(db, "alice")).toEqual({ xp: 125, version: 1 });
  });

  it("accumulates across games", async () => {
    await service.awardGame(await duel("ONE234", "2026-10-07T11:00:00Z"));
    await service.awardGame(await duel("TWO234", "2026-10-07T12:00:00Z"));
    expect(await progressRow(db, "alice")).toEqual({ xp: 250, version: 2 });
  });

  it("pays a solo game for pairs and streak only", async () => {
    const id = await seedGame(db, {
      code: "SOL234",
      players: [{ userId: "alice", rank: 1, pairs: 8, bestStreak: 8 }],
    });
    expect(await service.awardGame(id)).toBe(true);
    expect(await progressRow(db, "alice")).toMatchObject({ xp: 115 }); // 80 + 35, no position
  });

  it("skips guests but still pays position XP to a signed-in player sharing a table with one", async () => {
    const id = await seedGame(db, {
      code: "MIX234",
      players: [
        { userId: "alice", rank: 1, pairs: 5, bestStreak: 1 },
        { userId: null, rank: 2, pairs: 3, bestStreak: 1 },
      ],
    });
    expect(await service.awardGame(id)).toBe(true);
    expect(await progressRow(db, "alice")).toMatchObject({ xp: 100 }); // 50 + 0 + 50
    const guests = await db.query(`SELECT 1 FROM player_progress`);
    expect(guests).toHaveLength(1);
  });

  it("marks a guests-only game as done so the sweeper never rescans it", async () => {
    const id = await seedGame(db, {
      code: "GST234",
      players: [
        { userId: null, rank: 1 },
        { userId: null, rank: 2 },
      ],
    });
    expect(await service.awardGame(id)).toBe(false);
    expect(await progressAppliedAt(db, id)).not.toBeNull();
    expect(await service.sweepUnawarded(10)).toEqual({ awarded: 0 });
  });

  it("pays pairs and streak, not position, to a player who left without a rank", async () => {
    const id = await seedGame(db, {
      code: "LFT234",
      players: [
        { userId: "alice", rank: 1, pairs: 4, bestStreak: 1 },
        { userId: "bob", rank: null, pairs: 3, bestStreak: 2 },
      ],
    });
    expect(await service.awardGame(id)).toBe(true);
    expect(await progressRow(db, "bob")).toMatchObject({ xp: 35 }); // 30 + 5, no position
  });

  it("does nothing for a game that is not finished", async () => {
    const id = await seedGame(db, {
      code: "LOB234",
      status: "playing",
      players: [{ userId: "alice", rank: null }],
    });
    expect(await service.awardGame(id)).toBe(false);
    expect(await progressRow(db, "alice")).toBeUndefined();
  });
});

describe("sweepUnawarded and awardFinishedTable", () => {
  it("awards finished games nobody awarded yet, oldest first, skipping unfinished ones", async () => {
    await duel("OLD234", "2026-10-07T10:00:00Z");
    await duel("NEW234", "2026-10-07T11:00:00Z");
    await seedGame(db, { code: "PLY234", status: "playing", players: [{ userId: "alice", rank: null }] });
    expect(await service.sweepUnawarded(10)).toEqual({ awarded: 2 });
    expect(await progressRow(db, "alice")).toMatchObject({ xp: 250 });
    expect(await service.sweepUnawarded(10)).toEqual({ awarded: 0 });
  });

  it("finds a game by table code", async () => {
    const id = await duel("COD234");
    await service.awardFinishedTable("COD234");
    expect(await progressAppliedAt(db, id)).not.toBeNull();
    await expect(service.awardFinishedTable("NOPE22")).resolves.toBeUndefined();
  });
});

describe("progressFor", () => {
  it("is level 1 with no XP for a player who has never been awarded", async () => {
    expect(await service.progressFor("nobody")).toEqual({
      xp: 0,
      level: 1,
      xpIntoLevel: 0,
      xpForNext: 100,
      achievements: [],
    });
  });

  it("reports XP and level after awarding", async () => {
    await service.awardGame(await duel("PRG234"));
    expect(await service.progressFor("alice")).toMatchObject({
      xp: 125,
      level: 2,
      xpIntoLevel: 25,
      xpForNext: 200,
    });
  });
});

describe("history", () => {
  it("shows the XP gained for an awarded game and null before it is awarded", async () => {
    const id = await duel("HIS234");
    expect((await listHistory(db, "alice"))[0]!.you).toMatchObject({ xpGained: null, xpAfter: null });
    await service.awardGame(id);
    expect((await listHistory(db, "alice"))[0]!.you).toMatchObject({ xpGained: 125, xpAfter: 125 });
  });
});

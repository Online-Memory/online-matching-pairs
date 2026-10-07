# Progression 3a: XP and Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in players earn XP once per finished game (matches found, streak, final position), levels derive from XP, and the results screen and profile show it.

**Architecture:** Pure shared `computeXp`/`levelForXp` in `src/lib/progress/`. A new additive migration (`player_progress`, `games.progress_applied_at`, `game_players.xp_gained/xp_after`). `ProgressService` claims the game and updates every participant's XP in ONE version-checked SQL statement (the `applyRatings` pattern), runs after the finishing response and from the daily cron sweep. The client reads XP through `GET /api/me/progress` and optional fields on the existing history entry.

**Tech Stack:** Next.js route handlers, Postgres via the `Db` interface (Neon/pg/PGlite), zod, React, Vitest (unit, component, PGlite integration).

**Spec:** `docs/superpowers/specs/2026-10-07-progression-design.md` (this plan is part 3a; achievements are plan 3b)

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`; never import it from components, `src/lib/client` or `src/lib/protocol`. `src/lib/progress/` is shared and must NOT import `server-only`.
- Saves are single statements with data-modifying CTEs; no interactive transactions (the Neon HTTP driver cannot do them). Version-checked, retried on conflict.
- Progress queries read `games`, `game_players` and `player_progress`, never `table_state`.
- The migration is additive and backward compatible (old deployment keeps serving). Use the `new-migration` skill rules: timestamp from `node -e 'console.log(Date.now())'`, both sections, no edits to existing migration files.
- **Never run `pnpm db:migrate` or `pnpm db:migrate:local`** (`.env.local` is production). Never edit `.env*`.
- **No git operations.** CLAUDE.md: git is the user's call. Leave everything uncommitted; there are no commit steps.
- The client treats any new optional field as "nothing to show" when absent (an older server omits it during a deploy).
- All animation behind `prefers-reduced-motion: no-preference`; reduced motion shows final values at once.
- XP rules verbatim from the spec: 10 per pair; 5 per step of best streak above 1, capped at 10 steps; position (only when 2 or more seated players): 1st +50, 2nd +30, 3rd +20, any other rank +10. Level `L` needs `50 * L * (L - 1)` total XP.
- Run `verify` (lint, format:check, typecheck, test) before declaring done; do not run Playwright/E2E. Run the `anti-cheat-reviewer` agent on the final diff (touches `src/lib/protocol/` and `src/server/db/`).
- The working tree holds unrelated uncommitted work (Phase 1 and 2 files, a `cheats` feature). Do not revert or reformat it. `src/app/globals.css` is shared: append your CSS at the end, never rewrite it.

## Review Focus

- Awarding twice, or two workers at once, must count XP exactly once (concurrent `awardGame` calls: one `true`, one `false`).
- Guest seats and guest-only games: guests earn nothing; a game with only guests is marked applied so the sweeper never rescans it; a signed-in player at a table with a guest still gets position XP (2 seated players).
- A solo game earns pairs and streak XP but no position XP.
- A player with `rank = null` (left the game) earns no position XP but keeps pairs/streak XP, and must not crash the awarding.
- An old server that omits `xpGained`/`xpAfter` must make the results screen show nothing (never `NaN`, `undefined` or a level-up).

---

### Task 1: Pure XP and level functions

**Files:**

- Create: `src/lib/progress/xp.ts`, `src/lib/progress/levels.ts`
- Test: `src/lib/progress/xp.test.ts`, `src/lib/progress/levels.test.ts`

**Interfaces:**

- Produces:
  - `type XpInput = { pairs: number; bestStreak: number; rank: number | null; players: number }`
  - `type XpBreakdown = { pairs: number; streak: number; position: number; total: number }`
  - `computeXp(input: XpInput): XpBreakdown`
  - `xpForLevel(level: number): number` (total XP to reach `level`, `level >= 1`)
  - `levelForXp(xp: number): { level: number; xpIntoLevel: number; xpForNext: number }` (`xpForNext` = XP the current level spans, i.e. `xpForLevel(level + 1) - xpForLevel(level)`)

- [ ] **Step 1: Write the failing tests**

`src/lib/progress/xp.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { computeXp } from "./xp";

describe("computeXp", () => {
  it("scores the spec's example: an 8-pair win with a best streak of 4", () => {
    expect(computeXp({ pairs: 8, bestStreak: 4, rank: 1, players: 2 })).toEqual({
      pairs: 80,
      streak: 15,
      position: 50,
      total: 145,
    });
  });

  it.each([
    [1, 50],
    [2, 30],
    [3, 20],
    [4, 10],
    [9, 10],
  ])("rank %i in a versus game earns %i position XP", (rank, position) => {
    expect(computeXp({ pairs: 0, bestStreak: 0, rank, players: 4 }).position).toBe(position);
  });

  it("earns no position XP alone, or without a rank", () => {
    expect(computeXp({ pairs: 8, bestStreak: 0, rank: 1, players: 1 }).position).toBe(0);
    expect(computeXp({ pairs: 3, bestStreak: 0, rank: null, players: 3 })).toMatchObject({
      position: 0,
      total: 30,
    });
  });

  it("pays 5 per step above a streak of 1, capped at 10 steps", () => {
    const streak = (bestStreak: number) => computeXp({ pairs: 0, bestStreak, rank: null, players: 1 }).streak;
    expect([0, 1, 2, 3, 11, 12, 40].map(streak)).toEqual([0, 0, 5, 10, 50, 50, 50]);
  });

  it("never goes negative on odd input", () => {
    expect(computeXp({ pairs: 0, bestStreak: -3, rank: null, players: 0 }).total).toBe(0);
  });
});
```

`src/lib/progress/levels.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { levelForXp, xpForLevel } from "./levels";

describe("levels", () => {
  it("needs 50 * L * (L - 1) XP in total to reach level L", () => {
    expect([1, 2, 3, 4, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000, 4500]);
  });

  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [999, 4],
    [1000, 5],
    [4499, 9],
    [4500, 10],
    [-5, 1],
  ])("%i XP is level %i", (xp, level) => {
    expect(levelForXp(xp).level).toBe(level);
  });

  it("reports progress inside the level", () => {
    expect(levelForXp(150)).toEqual({ level: 2, xpIntoLevel: 50, xpForNext: 200 });
    expect(levelForXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNext: 100 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/progress`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/lib/progress/xp.ts`:

```ts
export const XP_PER_PAIR = 10;
export const XP_PER_STREAK_STEP = 5;
export const STREAK_STEP_CAP = 10;
const OTHER_POSITION_XP = 10;
const POSITION_XP: Readonly<Record<number, number>> = { 1: 50, 2: 30, 3: 20 };

export type XpInput = {
  pairs: number;
  bestStreak: number;
  /** Final position; null for a player who left before the end. */
  rank: number | null;
  /** Seated players, guests included: position only counts when someone else was playing. */
  players: number;
};
export type XpBreakdown = { pairs: number; streak: number; position: number; total: number };

/** XP for one player's finished game: matches found, best streak, final position. Pure; shared by server and client. */
export function computeXp({ pairs, bestStreak, rank, players }: XpInput): XpBreakdown {
  const pairsXp = Math.max(0, pairs) * XP_PER_PAIR;
  const streakXp = Math.min(Math.max(0, bestStreak - 1), STREAK_STEP_CAP) * XP_PER_STREAK_STEP;
  const positionXp = players >= 2 && rank !== null ? (POSITION_XP[rank] ?? OTHER_POSITION_XP) : 0;
  return { pairs: pairsXp, streak: streakXp, position: positionXp, total: pairsXp + streakXp + positionXp };
}
```

`src/lib/progress/levels.ts`:

```ts
/** Total XP needed to reach `level` (level 1 needs none). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

/** Level is derived from XP, never stored. `xpForNext` is the width of the current level. */
export function levelForXp(xp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  const safe = Math.max(0, Math.floor(xp));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * safe) / 50)) / 2));
  while (xpForLevel(level + 1) <= safe) level++;
  while (level > 1 && xpForLevel(level) > safe) level--;
  return {
    level,
    xpIntoLevel: safe - xpForLevel(level),
    xpForNext: xpForLevel(level + 1) - xpForLevel(level),
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/lib/progress`
Expected: PASS.

---

### Task 2: Migration

**Files:**

- Create: `db/migrations/<epoch>_progress.sql` (epoch from `node -e 'console.log(Date.now())'`; it must sort after `1791361609604_profile-current-table.sql`)
- Modify: `tests/integration/db.ts` (both `TRUNCATE` lists)
- Test: `tests/integration/progress-migration.test.ts`

**Interfaces:**

- Produces schema: table `player_progress(user_id text pk, xp int, version int, updated_at timestamptz)`; `games.progress_applied_at timestamptz`; `game_players.xp_gained int`, `game_players.xp_after int` (both nullable).

- [ ] **Step 1: Write the failing test**

`tests/integration/progress-migration.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("progress migration", () => {
  it("marks games finished before it as already awarded and leaves other games unawarded", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const index = files.findIndex((f) => f.endsWith("_progress.sql"));
    expect(index).toBeGreaterThan(0);
    const up = async (file: string) => {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    };

    for (const file of files.slice(0, index)) await up(file);
    await db.exec(
      `INSERT INTO games (id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, started_at, finished_at)
       VALUES ('00000000-0000-0000-0000-00000000000a', 'OLD234', 'p', '001', 8, 4, 20, 'finished',
               '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
              ('00000000-0000-0000-0000-00000000000b', 'LOB234', 'p', '001', 8, 4, 20, 'lobby', NULL, NULL)`,
    );
    await up(files[index]!);

    const rows = (
      await db.query<{ code: string; progress_applied_at: Date | null }>(
        `SELECT code, progress_applied_at FROM games ORDER BY code`,
      )
    ).rows;
    expect(rows[0]!.code).toBe("LOB234");
    expect(rows[0]!.progress_applied_at).toBeNull();
    expect(rows[1]!.code).toBe("OLD234");
    expect(new Date(rows[1]!.progress_applied_at!).toISOString()).toBe("2026-10-01T10:00:00.000Z");

    await db.exec(`INSERT INTO player_progress (user_id) VALUES ('u1')`);
    const progress = (
      await db.query<{ xp: number; version: number }>(`SELECT xp, version FROM player_progress`)
    ).rows[0];
    expect(progress).toEqual({ xp: 0, version: 0 });
    await db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/progress-migration.test.ts`
Expected: FAIL (`index` is -1: no `_progress.sql`).

- [ ] **Step 3: Create the migration**

Get the timestamp (`node -e 'console.log(Date.now())'`) and create `db/migrations/<epoch>_progress.sql`:

```sql
-- Up Migration

-- XP and levels. Purely additive: the old deployment never reads or writes any of this.
CREATE TABLE player_progress (
  user_id text PRIMARY KEY,
  xp int NOT NULL DEFAULT 0 CHECK (xp >= 0),
  version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- NULL = XP not awarded yet. Set in the same statement that updates every player's XP (idempotency flag).
-- Separate from rated_at: solo games and games with guests are never rated but still award XP.
ALTER TABLE games ADD COLUMN progress_applied_at timestamptz;
ALTER TABLE game_players ADD COLUMN xp_gained int;
ALTER TABLE game_players ADD COLUMN xp_after int;

-- No retroactive XP: games finished before this migration are never awarded. Games the old deployment
-- finishes between migrating and promotion keep progress_applied_at NULL and are awarded by the sweeper.
UPDATE games SET progress_applied_at = COALESCE(finished_at, now()) WHERE status = 'finished';

CREATE INDEX games_unprogressed_idx ON games (finished_at)
  WHERE status = 'finished' AND progress_applied_at IS NULL;

-- Down Migration

DROP INDEX games_unprogressed_idx;
ALTER TABLE game_players DROP COLUMN xp_after;
ALTER TABLE game_players DROP COLUMN xp_gained;
ALTER TABLE games DROP COLUMN progress_applied_at;
DROP TABLE player_progress;
```

In `tests/integration/db.ts`, both `TRUNCATE` strings (the pg one and the PGlite one) become:

```
TRUNCATE games, profiles, friendships, table_invites, player_ratings, player_progress CASCADE
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/progress-migration.test.ts`
Expected: PASS. Do NOT run `pnpm db:migrate*`.

---

### Task 3: Progress DB layer and service

**Files:**

- Create: `src/server/db/progress.ts`, `src/server/progress/service.ts`, `src/server/progress/index.ts`
- Create: `tests/integration/progress-helpers.ts`
- Test: `tests/integration/progress-service.test.ts`

**Interfaces:**

- Consumes: `computeXp`, `levelForXp` (Task 1); migration (Task 2); `seedGame` from `tests/integration/ratings-helpers.ts`.
- Produces:
  - `src/server/db/progress.ts`: `loadGameToAward(db, gameId)`, `markNoProgress(db, gameId, at)`, `ensureProgressRows(db, userIds)`, `loadProgress(db, userIds)`, `applyProgress(db, gameId, at, updates)`, `listUnawarded(db, limit)`, `queryXp(db, userId)`; type `ProgressUpdate`.
  - `ProgressService` (`src/server/progress/service.ts`): `awardGame(gameId): Promise<boolean>` (true only when this call claimed the game), `awardFinishedTable(code): Promise<void>`, `sweepUnawarded(limit): Promise<{ awarded: number }>`, `progressFor(userId): Promise<ProgressResponse>`. Constructor `new ProgressService(db, { clock? })`.
  - `getProgressService(): Promise<ProgressService>` (`src/server/progress/index.ts`).
  - `ProgressResponse` is added to the protocol in Task 4; this task returns the same shape and the service imports the type from `@/lib/protocol`, so **add the type first** (Step 3 below).

- [ ] **Step 1: Write helpers and the failing tests**

`tests/integration/progress-helpers.ts`:

```ts
import type { Db } from "@/server/db";

export async function progressRow(db: Db, userId: string) {
  const rows = await db.query<{ xp: number; version: number }>(
    `SELECT xp, version FROM player_progress WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function progressAppliedAt(db: Db, gameId: string) {
  const rows = await db.query<{ progress_applied_at: Date | null }>(
    `SELECT progress_applied_at FROM games WHERE id = $1`,
    [gameId],
  );
  return rows[0]!.progress_applied_at;
}

export async function gainRow(db: Db, gameId: string, userId: string) {
  const rows = await db.query<{ xp_gained: number | null; xp_after: number | null }>(
    `SELECT xp_gained, xp_after FROM game_players WHERE game_id = $1 AND user_id = $2`,
    [gameId, userId],
  );
  return rows[0];
}
```

`tests/integration/progress-service.test.ts`:

```ts
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
    });
  });

  it("reports XP and level after awarding", async () => {
    await service.awardGame(await duel("PRG234"));
    expect(await service.progressFor("alice")).toEqual({
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/progress-service.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Add the protocol types**

In `src/lib/protocol/index.ts`, change `HistoryEntry.you` to add two optional fields after `ratingAfter`:

```ts
    /** XP this game paid and the player's XP afterwards. Null until awarded; absent from an older server. */
    xpGained?: number | null;
    xpAfter?: number | null;
```

and add, after `StatsResponse`:

```ts
export type ProgressResponse = {
  xp: number;
  level: number;
  /** XP earned inside the current level, and how wide the level is. */
  xpIntoLevel: number;
  xpForNext: number;
};
```

- [ ] **Step 4: Implement the DB layer**

`src/server/db/progress.ts`:

```ts
import "server-only";

import { z } from "zod";

import type { Db } from "./client";

const ids = (userIds: string[]) => JSON.stringify(userIds);

const gameRowSchema = z.object({
  user_id: z.string().nullable(),
  pairs: z.number().int(),
  best_streak: z.number().int(),
  rank: z.number().int().nullable(),
  seated: z.number().int(),
});

/**
 * The seated players of a finished game whose XP has not been awarded; null if there is nothing to award.
 * `seated` counts guests too: position XP only needs someone else at the table.
 */
export async function loadGameToAward(db: Db, gameId: string) {
  const rows = await db.query(
    `SELECT gp.user_id, gp.pairs, gp.best_streak, gp.rank,
            (SELECT count(*) FROM game_players o WHERE o.game_id = g.id)::int AS seated
       FROM games g JOIN game_players gp ON gp.game_id = g.id
      WHERE g.id = $1 AND g.status = 'finished' AND g.progress_applied_at IS NULL`,
    [gameId],
  );
  if (rows.length === 0) return null;
  const parsed = rows.map((raw) => gameRowSchema.parse(raw));
  return {
    seated: parsed[0]!.seated,
    participants: parsed.flatMap((r) =>
      r.user_id === null
        ? []
        : [{ userId: r.user_id, pairs: r.pairs, bestStreak: r.best_streak, rank: r.rank }],
    ),
  };
}

/** A finished game with nobody to pay (guests only): mark it so the sweeper skips it. */
export async function markNoProgress(db: Db, gameId: string, at: string) {
  await db.query(
    `UPDATE games SET progress_applied_at = $2::timestamptz
      WHERE id = $1 AND status = 'finished' AND progress_applied_at IS NULL`,
    [gameId, at],
  );
}

export async function ensureProgressRows(db: Db, userIds: string[]) {
  await db.query(
    `INSERT INTO player_progress (user_id)
     SELECT jsonb_array_elements_text($1::jsonb)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids(userIds)],
  );
}

const progressRowSchema = z.object({ user_id: z.string(), xp: z.number().int(), version: z.number().int() });

export async function loadProgress(db: Db, userIds: string[]) {
  const rows = await db.query(
    `SELECT user_id, xp, version FROM player_progress
      WHERE user_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [ids(userIds)],
  );
  return new Map(
    rows.map((raw) => {
      const r = progressRowSchema.parse(raw);
      return [r.user_id, { xp: r.xp, version: r.version }] as const;
    }),
  );
}

export type ProgressUpdate = { userId: string; expectedVersion: number; gained: number; xpAfter: number };

/**
 * Claims the game and applies every player's XP in ONE statement, the way `applyRatings` does: `ok` locks
 * the player rows and counts how many still have the version we read; if any moved, nothing is claimed
 * and nothing is written, so the caller re-reads and retries. A game already awarded is never claimed
 * twice. Returns true only when this call claimed the game.
 */
export async function applyProgress(db: Db, gameId: string, at: string, updates: ProgressUpdate[]) {
  const input = updates.map((u) => ({
    user_id: u.userId,
    expected_version: u.expectedVersion,
    gained: u.gained,
    xp_after: u.xpAfter,
  }));
  const rows = await db.query<{ claimed: number }>(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb)
         AS x(user_id text, expected_version int, gained int, xp_after int)
     ), ok AS (
       SELECT count(*) = (SELECT count(*) FROM input) AS ok
         FROM (SELECT 1 FROM player_progress p JOIN input i ON i.user_id = p.user_id
                WHERE p.version = i.expected_version FOR UPDATE OF p) locked
     ), claim AS (
       UPDATE games SET progress_applied_at = $2::timestamptz
        WHERE id = $1 AND status = 'finished' AND progress_applied_at IS NULL AND (SELECT ok FROM ok)
       RETURNING id
     ), upd AS (
       UPDATE player_progress pp
          SET xp = i.xp_after, version = pp.version + 1, updated_at = $2::timestamptz
         FROM input i
        WHERE pp.user_id = i.user_id AND pp.version = i.expected_version AND EXISTS (SELECT 1 FROM claim)
       RETURNING pp.user_id
     ), gp AS (
       UPDATE game_players g SET xp_gained = i.gained, xp_after = i.xp_after
         FROM input i
        WHERE g.game_id = $1 AND g.user_id = i.user_id AND EXISTS (SELECT 1 FROM claim)
       RETURNING g.user_id
     )
     SELECT (SELECT count(*) FROM claim)::int AS claimed`,
    [gameId, at, JSON.stringify(input)],
  );
  return Number(rows[0]?.claimed) === 1;
}

/** Finished games nobody awarded yet, oldest first. */
export async function listUnawarded(db: Db, limit: number) {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM games
      WHERE status = 'finished' AND progress_applied_at IS NULL
      ORDER BY finished_at NULLS FIRST, id
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

/** A player's total XP; 0 when they have never been awarded any. */
export async function queryXp(db: Db, userId: string) {
  const rows = await db.query<{ xp: number }>(`SELECT xp FROM player_progress WHERE user_id = $1`, [userId]);
  return rows[0] ? Number(rows[0].xp) : 0;
}
```

- [ ] **Step 5: Implement the service and its accessor**

`src/server/progress/service.ts`:

```ts
import "server-only";

import { levelForXp } from "@/lib/progress/levels";
import { computeXp } from "@/lib/progress/xp";
import type { ProgressResponse } from "@/lib/protocol";
import type { Db } from "@/server/db";
import {
  applyProgress,
  ensureProgressRows,
  listUnawarded,
  loadGameToAward,
  loadProgress,
  markNoProgress,
  queryXp,
} from "@/server/db/progress";
import { ServiceError } from "@/server/tables/service";

const MAX_ATTEMPTS = 5;

type Options = { clock?: () => number };

export class ProgressService {
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    options: Options = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  /** Awards one finished game. True if this call applied it; false if there was nothing to do. Idempotent. */
  async awardGame(gameId: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const game = await loadGameToAward(this.db, gameId);
      if (!game) return false;

      const at = new Date(this.clock()).toISOString();
      if (game.participants.length === 0) {
        await markNoProgress(this.db, gameId, at);
        return false;
      }

      const userIds = game.participants.map((p) => p.userId);
      await ensureProgressRows(this.db, userIds);
      const current = await loadProgress(this.db, userIds);

      const applied = await applyProgress(
        this.db,
        gameId,
        at,
        game.participants.map((p) => {
          const c = current.get(p.userId)!;
          const gained = computeXp({
            pairs: p.pairs,
            bestStreak: p.bestStreak,
            rank: p.rank,
            players: game.seated,
          }).total;
          return { userId: p.userId, expectedVersion: c.version, gained, xpAfter: c.xp + gained };
        }),
      );
      if (applied) return true;
    }
    throw new ServiceError("conflict", "Progress is busy, try again");
  }

  async awardFinishedTable(code: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM games WHERE code = $1`, [code]);
    if (rows[0]) await this.awardGame(rows[0].id);
  }

  /** Backstop for games whose after-response awarding never ran. Sequential: games share players. */
  async sweepUnawarded(limit: number): Promise<{ awarded: number }> {
    let awarded = 0;
    for (const id of await listUnawarded(this.db, limit)) {
      try {
        if (await this.awardGame(id)) awarded++;
      } catch (error) {
        console.error("progress sweep failed for a game", error);
      }
    }
    return { awarded };
  }

  async progressFor(userId: string): Promise<ProgressResponse> {
    const xp = await queryXp(this.db, userId);
    return { xp, ...levelForXp(xp) };
  }
}
```

`src/server/progress/index.ts`:

```ts
import "server-only";

import { getDb } from "@/server/db";

import { ProgressService } from "./service";

export * from "./service";

let service: Promise<ProgressService> | undefined;

export function getProgressService(): Promise<ProgressService> {
  service ??= getDb().then((db) => new ProgressService(db));
  return service;
}
```

- [ ] **Step 6: Return the XP fields from history**

In `src/server/db/history.ts`: add to `historyRowSchema`'s player object, after `rating_after`:

```ts
      xp_gained: z.number().int().nullable(),
      xp_after: z.number().int().nullable(),
```

add to the `jsonb_build_object(...)` in the SQL, after `'rating_before', o.rating_before, 'rating_after', o.rating_after`:

```sql
, 'xp_gained', o.xp_gained, 'xp_after', o.xp_after
```

and add to the `you` object, after `ratingAfter: me.rating_after,`:

```ts
        xpGained: me.xp_gained,
        xpAfter: me.xp_after,
```

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm vitest run tests/integration/progress-service.test.ts`
Expected: PASS (all). If the concurrency test is flaky on PGlite (a single connection serializes the statements), it must still pass: the second call re-reads `progress_applied_at` and returns false. If `listHistory`'s existing tests assert an exact `you` object, add the two new fields there rather than loosening the assertion.

---

### Task 4: Awarding runs, route, cron

**Files:**

- Create: `src/server/progress/after.ts`, `src/app/api/me/progress/route.ts`
- Modify: `src/server/actions.ts` (add the second `after` call), `src/app/api/cron/cleanup/route.ts`, `src/lib/client/api.ts`
- Test: `src/server/progress/after.test.ts`, `tests/integration/progress-routes.test.ts`

**Interfaces:**

- Consumes: `getProgressService`, `ProgressService` (Task 3); `ProgressResponse` (Task 3).
- Produces: `awardAfterResponse(code: string): void`; `GET /api/me/progress` (401 for guests, else `ProgressResponse`); `api.progress(): Promise<ProgressResponse>`; the cron response gains `awarded`.

- [ ] **Step 1: Write the failing tests**

`src/server/progress/after.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const awardFinishedTable = vi.fn();
vi.mock("./index", () => ({ getProgressService: async () => ({ awardFinishedTable }) }));
const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));

import { awardAfterResponse } from "./after";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("awardAfterResponse", () => {
  it("schedules the awarding with after() and awards the table when it runs", async () => {
    afterMock.mockImplementation(() => undefined);
    awardAfterResponse("ABC234");
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]![0]();
    expect(awardFinishedTable).toHaveBeenCalledWith("ABC234");
  });

  it("runs the awarding anyway when after() is unavailable (outside a request)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    awardAfterResponse("ABC234");
    await vi.waitFor(() => expect(awardFinishedTable).toHaveBeenCalledWith("ABC234"));
  });

  it("logs and swallows a failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    awardFinishedTable.mockRejectedValueOnce(new Error("db down"));
    afterMock.mockImplementation(() => undefined);
    awardAfterResponse("ABC234");
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
```

`tests/integration/progress-routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET as progress } from "@/app/api/me/progress/route";

describe("progress route", () => {
  it("answers 401 to guests", async () => {
    const response = await progress(new Request("http://x/api/me/progress"), {
      params: Promise.resolve({}),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/server/progress/after.test.ts tests/integration/progress-routes.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/server/progress/after.ts`:

```ts
import "server-only";

import { after } from "next/server";

import { getProgressService } from "./index";

/**
 * Awards XP for a table that just finished, after the response has gone out so players never wait on it.
 * Best effort: a failure is logged and the daily cron sweep picks the game up later.
 */
export function awardAfterResponse(code: string): void {
  const run = async () => {
    try {
      await (await getProgressService()).awardFinishedTable(code);
    } catch (error) {
      console.error("xp award after game end failed", error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
```

`src/app/api/me/progress/route.ts`:

```ts
import { NextResponse } from "next/server";

import type { ProgressResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getProgressService } from "@/server/progress";
import { ServiceError } from "@/server/tables";

export const GET = route(async () => {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your level");
  return NextResponse.json<ProgressResponse>(await (await getProgressService()).progressFor(user.id));
});
```

`src/server/actions.ts`: add `import { awardAfterResponse } from "@/server/progress/after";` next to the `rateAfterResponse` import, and change the finished line to:

```ts
if (snapshot.view.status === "finished") {
  rateAfterResponse(code);
  awardAfterResponse(code);
}
```

`src/app/api/cron/cleanup/route.ts`: add `import { getProgressService } from "@/server/progress";`, extend the `Promise.all` destructuring and call:

```ts
const [tables, invites, ratings, progress] = await Promise.all([
  cleanupTables(await getDb(), Date.now()),
  (await getFriendsService()).cleanup(),
  (await getRatingsService()).sweepUnrated(200),
  (await getProgressService()).sweepUnawarded(200),
]);
return NextResponse.json({ ...tables, ...invites, ...ratings, ...progress });
```

and update the doc comment above `GET` to say it also awards XP for finished games whose after-response awarding never ran.

`src/lib/client/api.ts`: add `ProgressResponse` to the `@/lib/protocol` type import and, after the `stats:` line:

```ts
  progress: () => request<ProgressResponse>("/api/me/progress"),
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/server/progress/after.test.ts tests/integration/progress-routes.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

---

### Task 5: Client: `useXpGain`, `XpGain`, `LevelBar`

**Files:**

- Create: `src/lib/client/use-xp-gain.ts`, `src/components/XpGain.tsx`, `src/components/LevelBar.tsx`
- Modify: `src/components/Results.tsx`, `src/components/Profile.tsx`, `src/app/globals.css` (append)
- Test: `src/lib/client/use-xp-gain.test.tsx`, `src/components/XpGain.test.tsx`, `src/components/LevelBar.test.tsx`; update `src/components/Profile.test.tsx` and `src/components/Results.test.tsx`

**Interfaces:**

- Consumes: `api.history`, `api.progress` (Task 4); `levelForXp` (Task 1); `useCountUp`, `ConfettiBurst` (existing); `ProgressResponse`.
- Produces:
  - `useXpGain(code: string, enabled: boolean, delays?: readonly number[]): { gained: number; after: number } | null`
  - `XpGain({ code }: { code: string })`: nothing unless signed in and the gain is known.
  - `LevelBar({ progress }: { progress: ProgressResponse })`

- [ ] **Step 1: Write the failing tests**

`src/lib/client/use-xp-gain.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/lib/protocol";

import { api } from "./api";
import { useXpGain } from "./use-xp-gain";

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const entry = (xp: { xpGained?: number | null; xpAfter?: number | null } = {}): HistoryEntry => ({
  code: "ABC234",
  theme: "001",
  pairs: 8,
  finishedAt: "2026-10-07T12:00:00.000Z",
  you: { pairs: 5, moves: 10, bestStreak: 2, rank: 1, ratingBefore: null, ratingAfter: null, ...xp },
  players: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useXpGain", () => {
  it("finds the gain on a later attempt, once the server has awarded the game", async () => {
    const history = vi
      .spyOn(api, "history")
      .mockResolvedValueOnce([entry({ xpGained: null, xpAfter: null })])
      .mockResolvedValue([entry({ xpGained: 125, xpAfter: 325 })]);
    const { result } = renderHook(() => useXpGain("ABC234", true, [100, 200, 300]));
    await advance(100);
    expect(result.current).toBeNull();
    await advance(200);
    expect(result.current).toEqual({ gained: 125, after: 325 });
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("treats fields an older server omits as not awarded yet, and gives up quietly", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry()]);
    const { result } = renderHook(() => useXpGain("ABC234", true, [100, 100]));
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.current).toBeNull();
  });

  it("does nothing when disabled, and stops when unmounted", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry()]);
    renderHook(() => useXpGain("ABC234", false, [100]));
    await advance(1_000);
    expect(history).not.toHaveBeenCalled();
    const { unmount } = renderHook(() => useXpGain("ABC234", true, [100, 100, 100]));
    await advance(100);
    unmount();
    await advance(1_000);
    expect(history).toHaveBeenCalledTimes(1);
  });
});
```

`src/components/XpGain.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as hook from "@/lib/client/use-xp-gain";

import { XpGain } from "./XpGain";

const signedIn = { authEnabled: true, user: { id: "a", name: "A", email: null, image: null } };

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("XpGain", () => {
  it("shows the XP gained and the level", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue({ gained: 50, after: 150 });
    render(<XpGain code="ABC234" />);
    expect(screen.getByRole("status")).toHaveTextContent("+50 XP");
    expect(screen.getByRole("status")).toHaveTextContent("Level 2");
    expect(screen.queryByText(/Level up/)).toBeNull(); // 100 XP before: already level 2
  });

  it("announces a level up when the gain crosses a level", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue({ gained: 60, after: 130 }); // 70 before: level 1
    render(<XpGain code="ABC234" />);
    expect(screen.getByText("Level up! You reached level 2")).toBeInTheDocument();
  });

  it("renders nothing for a guest, and looks only for a signed-in player", () => {
    const spy = vi.spyOn(hook, "useXpGain").mockReturnValue(null);
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const { container } = render(<XpGain code="ABC234" />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).toHaveBeenCalledWith("ABC234", false);
  });

  it("renders nothing while the gain is unknown", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useXpGain").mockReturnValue(null);
    const { container } = render(<XpGain code="ABC234" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`src/components/LevelBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LevelBar } from "./LevelBar";

afterEach(cleanup);

describe("LevelBar", () => {
  it("shows the level and the progress through it", () => {
    render(<LevelBar progress={{ xp: 150, level: 2, xpIntoLevel: 50, xpForNext: 200 }} />);
    expect(screen.getByText("Level 2")).toBeInTheDocument();
    expect(screen.getByText("50 / 200 XP")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
  });
});
```

In `src/components/Profile.test.tsx`: add to `beforeEach` (after the `api.stats` spy):

```tsx
vi.spyOn(api, "progress").mockResolvedValue({ xp: 150, level: 2, xpIntoLevel: 50, xpForNext: 200 });
```

and add a test inside `describe("Profile", …)`:

```tsx
it("shows the level bar, and still renders when progress fails to load", async () => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: "a@example.com", image: null },
  });
  const { unmount } = render(<Profile />);
  expect(await screen.findByText("Level 2")).toBeInTheDocument();
  unmount();

  vi.spyOn(api, "progress").mockRejectedValue(new Error("boom"));
  render(<Profile />);
  expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
  expect(screen.queryByText(/^Level /)).toBeNull();
});
```

In `src/components/Results.test.tsx` (existing, from Phase 2): add `vi.spyOn(xpHook, "useXpGain").mockReturnValue(null);` to its `beforeEach` with `import * as xpHook from "@/lib/client/use-xp-gain";`, so the new `XpGain` inside `Results` stays quiet there.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/lib/client/use-xp-gain.test.tsx src/components/XpGain.test.tsx src/components/LevelBar.test.tsx src/components/Profile.test.tsx`
Expected: FAIL (modules missing; no level bar).

- [ ] **Step 3: Implement the hook**

`src/lib/client/use-xp-gain.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

export type XpGain = { gained: number; after: number };

/** The server awards just after the finishing request, so look a few times with growing gaps. */
const DEFAULT_DELAYS_MS = [1_500, 3_000, 6_000] as const;

/**
 * This game's XP, read from the player's history. Silent by design: if it never shows up (guest, old
 * server, network trouble) the results screen simply has no XP line. A field the server omits counts
 * as "not awarded yet".
 */
export function useXpGain(
  code: string,
  enabled: boolean,
  delays: readonly number[] = DEFAULT_DELAYS_MS,
): XpGain | null {
  const [gain, setGain] = useState<XpGain | null>(null);

  useEffect(() => {
    if (!enabled || delays.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (n: number) => {
      try {
        const you = (await api.history()).find((h) => h.code === code)?.you;
        if (typeof you?.xpGained === "number" && typeof you.xpAfter === "number") {
          if (!cancelled) setGain({ gained: you.xpGained, after: you.xpAfter });
          return;
        }
      } catch {
        // try again below
      }
      if (!cancelled && n + 1 < delays.length) timer = setTimeout(() => void attempt(n + 1), delays[n + 1]);
    };

    timer = setTimeout(() => void attempt(0), delays[0]);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, enabled, delays]);

  return gain;
}
```

- [ ] **Step 4: Implement the components**

`src/components/LevelBar.tsx`:

```tsx
import type { ProgressResponse } from "@/lib/protocol";

/** Level and progress to the next one. Plain numbers; the bar width is the only visual. */
export function LevelBar({ progress }: { progress: ProgressResponse }) {
  const fraction = progress.xpForNext > 0 ? Math.min(1, progress.xpIntoLevel / progress.xpForNext) : 0;
  return (
    <section className="level-bar" aria-label="Level">
      <p className="level-bar-title">Level {progress.level}</p>
      <div
        className="level-bar-track"
        role="progressbar"
        aria-label="Progress to the next level"
        aria-valuemin={0}
        aria-valuenow={progress.xpIntoLevel}
        aria-valuemax={progress.xpForNext}
      >
        <div className="level-bar-fill" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="hint">
        {progress.xpIntoLevel} / {progress.xpForNext} XP
      </p>
    </section>
  );
}
```

`src/components/XpGain.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { levelForXp } from "@/lib/progress/levels";
import { useCountUp } from "@/lib/client/use-count-up";
import { useMe } from "@/lib/client/use-me";
import { useXpGain, type XpGain as Gain } from "@/lib/client/use-xp-gain";

import { ConfettiBurst } from "./Confetti";

const COUNT_MS = 800;

/** Its own component so the count-up mounts only once the gain is known, and starts from 0. */
function XpLine({ gain }: { gain: Gain }) {
  const shown = useCountUp(gain.gained, { from: 0, durationMs: COUNT_MS });
  const level = levelForXp(gain.after).level;
  const levelUp = level > levelForXp(gain.after - gain.gained).level;

  const bannerRef = useRef<HTMLParagraphElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!levelUp) return;
    const box = bannerRef.current?.getBoundingClientRect();
    if (box) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [levelUp]);

  return (
    <>
      <p className="xp-gain" role="status">
        +{shown} XP · Level {level}
      </p>
      {levelUp && (
        <p className="level-up" ref={bannerRef}>
          Level up! You reached level {level}
        </p>
      )}
      {levelUp && origin && <ConfettiBurst x={origin.x} y={origin.y} count={60} delayMs={COUNT_MS} />}
    </>
  );
}

/** "+125 XP · Level 3" once the server has awarded the game. Nothing for guests or while unknown. */
export function XpGain({ code }: { code: string }) {
  const me = useMe();
  const gain = useXpGain(code, Boolean(me?.user));
  return gain ? <XpLine gain={gain} /> : null;
}
```

`src/components/Results.tsx`: add `import { XpGain } from "./XpGain";` after the `Scoreboard` import and render `<XpGain code={view.code} />` directly after the `<RatingChange … />` line.

`src/components/Profile.tsx`: add `import type { ProgressResponse, StatsResponse } from "@/lib/protocol";` (extend the existing type import), `import { LevelBar } from "./LevelBar";` after `FriendsPanel`, state `const [progress, setProgress] = useState<ProgressResponse | null>(null);`, extend the effect:

```tsx
useEffect(() => {
  if (!me?.user) return;
  api.stats().then(setStats, () => setStats(null));
  api.progress().then(setProgress, () => setProgress(null));
}, [me?.user]);
```

and render `{progress && <LevelBar progress={progress} />}` directly above the stats block (`{stats === undefined ? …`).

Append to the end of `src/app/globals.css`:

```css
/* -------------------------------------------------------------- xp and levels */

.xp-gain {
  margin: 0.25rem 0;
  font-weight: 800;
}

.level-up {
  margin: 0.25rem 0 0.75rem;
  font-size: 1.125rem;
  font-weight: 800;
}

.level-bar {
  margin: 0 0 1rem;
  max-width: 24rem;
}
.level-bar-title {
  margin: 0 0 0.25rem;
  font-size: 1.25rem;
  font-weight: 800;
}
.level-bar-track {
  height: 0.75rem;
  border-radius: 999px;
  background: var(--line);
  overflow: hidden;
}
.level-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--signal);
}

@media (prefers-reduced-motion: no-preference) {
  .level-up {
    animation: promotion-in 500ms cubic-bezier(0.2, 0.9, 0.3, 1.4) 800ms both;
  }
  .level-bar-fill {
    transition: width 600ms ease-out;
  }
}
```

(`promotion-in` is the keyframe added in Phase 2; if it is absent in the working tree, define an equivalent `@keyframes level-up-in` with the same body and use that name.)

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/lib/client/use-xp-gain.test.tsx src/components/XpGain.test.tsx src/components/LevelBar.test.tsx src/components/Profile.test.tsx src/components/Results.test.tsx`
Expected: PASS.

---

### Task 6: Verify, review, report

- [ ] **Step 1:** Run the `verify` skill (lint → format:check → typecheck → test). Fix at the cause. Do not run E2E. Do not run `pnpm db:migrate*`.
- [ ] **Step 2:** Run the `anti-cheat-reviewer` agent on the diff, telling it that unrelated uncommitted work (the `cheats` feature, Phases 1 and 2) is also present and out of scope. Expected: no face leaks from my change; new DB reads only `games`, `game_players`, `player_progress`.
- [ ] **Step 3:** Report what is ready to commit (nothing is committed), the migration file name, and that the migration has NOT been applied anywhere: the user decides when to run it.

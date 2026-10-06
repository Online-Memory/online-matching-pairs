# Ratings, stats and leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in players get an Elo-style rating, lifetime stats and global / friends leaderboards, computed after a game finishes without touching the hot save path.

**Architecture:** A pure `computeRatings` function does pairwise multi-player Elo. A `RatingsService` claims a finished game (`games.rated_at`) and applies every player's new rating in ONE data-modifying-CTE statement guarded by per-player `version` checks, retrying on conflict. It runs after the finishing response (`after()`), with the daily cron as a backstop. Stats and leaderboards read only `games`, `game_players`, `player_ratings` (and `profiles` for names); `TableService`, the engine and `table_state` are untouched.

**Tech Stack:** Next.js 16 (read `node_modules/next/dist/docs/` before writing route code), TypeScript, zod, Postgres (Neon / PGlite), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-06-ratings-leaderboards-design.md`

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`. Never import server code from components, `src/lib/client`, `src/lib/protocol`, pages or layouts.
- The engine stays pure and is not modified. `TableService` is not modified.
- Rating, stats and leaderboard queries read `games`, `game_players`, `player_ratings`, `profiles` only. **Never `table_state`.** Friend ids come from `FriendsService`, never from a direct `friendships` read in ratings code.
- Multi-table writes are ONE statement with data-modifying CTEs. No interactive transactions (the Neon HTTP driver has none).
- The migration is a new file, purely additive, backward compatible, and existing migration files are never edited.
- Rated game = `status = 'finished'` with 2 or more signed-in players that have a non-null `rank`. Guests are ignored and are not opponents. Abandoned games are never rated.
- Rating constants (spec section 2): start 1000, floor 100, `K = 32`, `K = 48` while `ratedGames < 10`, `delta = K/(n-1) * sum_j w_ij * (S_ij - E_ij)` rounded, `w_ij = max(0.25, 1 - 0.25 * k)` with `k` = rated games the pair shared in the previous 24 h.
- Leaderboard: no minimum game count. Order is rating desc, `rated_games` desc, `user_id`. Global is public; friends scope needs sign-in. Responses carry handle and display name, **never `user_id`**.
- No backfill: the migration marks already-finished games `rated_at = finished_at`.
- **Git is the user's call:** do not commit, branch or push. Each task ends with "leave uncommitted" and the verification run.
- Never run `pnpm db:migrate`, `pnpm db:migrate:local`, Playwright/E2E, or edit `.env*` files. PGlite tests apply `db/migrations` themselves.
- CI order: `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`.

## Review Focus

Failure modes the spec implies but no happy-path test covers; each has a pinning test in the owning task.

1. A finished game with a guest, or with fewer than 2 signed-in players, must not create ratings and must not be re-scanned by the sweeper forever (Task 5).
2. Two games finishing at once for the same player must not lose or double-apply an update; a stale version changes nothing (Task 3, Task 5).
3. The same game triggered twice (`after()` and the cron) is rated exactly once (Task 3, Task 5).
4. A signed-in player with no `profiles` row, or with no rated games, must not crash the leaderboard or stats (no division by zero, `handle: null`, name "Player") (Task 5, Task 8).
5. The rating line on the results screen must never block or error: a guest sees nothing, a late rating still appears, a failed fetch is silent; a guest asking for the friends scope gets 401 (Task 7, Task 10).

## File Structure

| File                                                                                                      | Responsibility                                                                    |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `db/migrations/<epoch-ms>_ratings.sql` (create)                                                           | `player_ratings`, `games.rated_at`, `game_players.rating_*`, mark old             |
| `src/server/ratings/rating.ts` (create)                                                                   | Pure Elo maths and constants                                                      |
| `src/server/db/ratings.ts` (create)                                                                       | All SQL for rating, sweeping, leaderboard, stats                                  |
| `src/server/ratings/service.ts` (create)                                                                  | `RatingsService`: orchestration, retry, response shaping                          |
| `src/server/ratings/index.ts` (create)                                                                    | `getRatingsService()` singleton                                                   |
| `src/server/ratings/after.ts` (create)                                                                    | `rateAfterResponse(code)`: `after()` with a safe fallback                         |
| `src/server/friends/service.ts` (modify)                                                                  | `friendIds(userId)`                                                               |
| `src/server/actions.ts` (modify)                                                                          | Trigger rating after a finishing action                                           |
| `src/app/api/cron/cleanup/route.ts` (modify)                                                              | Sweep unrated games                                                               |
| `src/lib/protocol/index.ts` (modify)                                                                      | `LeaderboardEntry`, `LeaderboardResponse`, `StatsResponse`, history rating fields |
| `src/server/db/history.ts` (modify)                                                                       | Return `rating_before` / `rating_after`                                           |
| `src/app/api/leaderboard/route.ts` (create)                                                               | `GET /api/leaderboard?scope=`                                                     |
| `src/app/api/me/stats/route.ts` (create)                                                                  | `GET /api/me/stats`                                                               |
| `src/lib/client/api.ts` (modify)                                                                          | `leaderboard`, `stats`                                                            |
| `src/components/StatsPanel.tsx` (create), `Profile.tsx` (modify)                                          | Stats block and per-game rating change on `/profile`                              |
| `src/components/Leaderboard.tsx`, `src/app/leaderboard/page.tsx` (create), `SiteHeader.tsx` (modify)      | Leaderboard page and link                                                         |
| `src/lib/client/use-rating-change.ts`, `src/components/RatingChange.tsx` (create), `Results.tsx` (modify) | Rating delta on the results screen                                                |
| `src/app/globals.css` (modify)                                                                            | Styles for the above                                                              |
| `tests/integration/db.ts` (modify), `ratings-helpers.ts` (create)                                         | Truncate `player_ratings`; seed helpers                                           |

---

### Task 1: Migration

**Files:**

- Create: `db/migrations/<epoch-ms>_ratings.sql` (use the `new-migration` skill; the timestamp must sort after `1791273079143`; e.g. `1791280000000_ratings.sql`)
- Modify: `tests/integration/db.ts` (both `TRUNCATE` lists)
- Test: `tests/integration/ratings-migration.test.ts`

**Interfaces:**

- Produces: table `player_ratings(user_id, rating, rated_games, wins, version, updated_at)`; columns `games.rated_at`, `game_players.rating_before`, `game_players.rating_after`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/ratings-migration.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("ratings migration", () => {
  it("marks games finished before it as already rated and leaves other games unrated", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const index = files.findIndex((f) => f.endsWith("_ratings.sql"));
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
      await db.query<{ code: string; rated_at: Date | null }>(
        `SELECT code, rated_at FROM games ORDER BY code`,
      )
    ).rows;
    expect(rows[0]!.code).toBe("LOB234");
    expect(rows[0]!.rated_at).toBeNull();
    expect(rows[1]!.code).toBe("OLD234");
    expect(new Date(rows[1]!.rated_at!).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    await db.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/integration/ratings-migration.test.ts`
Expected: FAIL (`index` is -1, the migration file does not exist).

- [ ] **Step 3: Create the migration**

Invoke the `new-migration` skill with name `ratings`; its file content must be:

```sql
-- Up Migration

-- Ratings. Purely additive: the old deployment never reads or writes any of this.
CREATE TABLE player_ratings (
  user_id text PRIMARY KEY,
  rating int NOT NULL DEFAULT 1000 CHECK (rating >= 100),
  rated_games int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX player_ratings_leaderboard_idx ON player_ratings (rating DESC, rated_games DESC, user_id);

-- NULL = not rated yet. Set in the same statement that applies the ratings (idempotency flag).
ALTER TABLE games ADD COLUMN rated_at timestamptz;
ALTER TABLE game_players ADD COLUMN rating_before int;
ALTER TABLE game_players ADD COLUMN rating_after int;

-- No backfill: games finished before this migration are never rated. Games the old deployment finishes
-- between migrating and promotion keep rated_at NULL and are rated by the sweeper.
UPDATE games SET rated_at = COALESCE(finished_at, now()) WHERE status = 'finished';

CREATE INDEX games_unrated_idx ON games (finished_at) WHERE status = 'finished' AND rated_at IS NULL;

-- Down Migration
```

- [ ] **Step 4: Make test resets clear ratings**

In `tests/integration/db.ts` change both `TRUNCATE games, profiles, friendships, table_invites CASCADE` strings to `TRUNCATE games, profiles, friendships, table_invites, player_ratings CASCADE`.

- [ ] **Step 5: Run the test and the whole suite**

Run: `pnpm vitest run tests/integration/ratings-migration.test.ts && pnpm test`
Expected: PASS. Leave uncommitted.

---

### Task 2: Pure rating maths

**Files:**

- Create: `src/server/ratings/rating.ts`
- Test: `src/server/ratings/rating.test.ts`

**Interfaces:**

- Produces:
  - `type RatingInput = { userId: string; rating: number; ratedGames: number; rank: number }`
  - `type RatingResult = { userId: string; newRating: number; delta: number; won: boolean }`
  - `computeRatings(players: readonly RatingInput[], repeatCounts?: ReadonlyMap<string, number>): RatingResult[]`
  - `pairKey(a: string, b: string): string` (order-independent), `repeatWeight(k: number): number`
  - constants `START_RATING, RATING_FLOOR, K_ESTABLISHED, K_PROVISIONAL, PROVISIONAL_GAMES, REPEAT_WINDOW_HOURS`

- [ ] **Step 1: Write the failing test**

Create `src/server/ratings/rating.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { computeRatings, K_ESTABLISHED, pairKey, repeatWeight, type RatingInput } from "./rating";

const p = (userId: string, rank: number, rating = 1000, ratedGames = 20): RatingInput => ({
  userId,
  rank,
  rating,
  ratedGames,
});
const byId = (results: ReturnType<typeof computeRatings>, id: string) =>
  results.find((r) => r.userId === id)!;

describe("computeRatings", () => {
  it("moves equal established players by K/2 each way", () => {
    const r = computeRatings([p("a", 1), p("b", 2)]);
    expect(byId(r, "a")).toMatchObject({ delta: 16, newRating: 1016, won: true });
    expect(byId(r, "b")).toMatchObject({ delta: -16, newRating: 984, won: false });
  });

  it("leaves equal players alone on a tie, and both win", () => {
    const r = computeRatings([p("a", 1), p("b", 1)]);
    expect(r.map((x) => x.delta)).toEqual([0, 0]);
    expect(r.every((x) => x.won)).toBe(true);
  });

  it("uses the larger K while a player is provisional", () => {
    const r = computeRatings([p("a", 1, 1000, 0), p("b", 2, 1000, 0)]);
    expect(byId(r, "a").delta).toBe(24);
    expect(byId(r, "b").delta).toBe(-24);
  });

  it("rewards an upset more than an expected win", () => {
    const upset = computeRatings([p("low", 1, 900), p("high", 2, 1100)]);
    const expected = computeRatings([p("high", 1, 1100), p("low", 2, 900)]);
    expect(byId(upset, "low").delta).toBe(24);
    expect(byId(expected, "high").delta).toBe(8);
  });

  it("keeps a 12-player game within K and roughly zero-sum", () => {
    const players = Array.from({ length: 12 }, (_, i) => p(`u${i}`, i + 1));
    const r = computeRatings(players);
    expect(byId(r, "u0").delta).toBe(16);
    expect(byId(r, "u11").delta).toBe(-16);
    expect(r.every((x) => Math.abs(x.delta) <= K_ESTABLISHED)).toBe(true);
    expect(Math.abs(r.reduce((sum, x) => sum + x.delta, 0))).toBeLessThanOrEqual(6);
  });

  it("damps a repeated pairing and never below the minimum weight", () => {
    expect(repeatWeight(0)).toBe(1);
    expect(repeatWeight(1)).toBe(0.75);
    expect(repeatWeight(2)).toBe(0.5);
    expect(repeatWeight(3)).toBe(0.25);
    expect(repeatWeight(9)).toBe(0.25);
    const r = computeRatings([p("a", 1), p("b", 2)], new Map([[pairKey("b", "a"), 1]]));
    expect(byId(r, "a").delta).toBe(12);
    expect(byId(r, "b").delta).toBe(-12);
  });

  it("never drops a rating below the floor", () => {
    const r = computeRatings([p("a", 1, 110), p("b", 2, 110)]);
    expect(byId(r, "b")).toMatchObject({ newRating: 100, delta: -10 });
  });

  it("returns a lone player unchanged", () => {
    expect(computeRatings([p("a", 1)])).toEqual([{ userId: "a", newRating: 1000, delta: 0, won: false }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/server/ratings/rating.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/server/ratings/rating.ts`:

```ts
import "server-only";

export const START_RATING = 1000;
export const RATING_FLOOR = 100;
export const K_ESTABLISHED = 32;
export const K_PROVISIONAL = 48;
/** Players with fewer rated games than this move faster, so a newcomer settles quickly. */
export const PROVISIONAL_GAMES = 10;
/** Pairs that already played each other within this window earn less from rematches. */
export const REPEAT_WINDOW_HOURS = 24;
const REPEAT_STEP = 0.25;
const REPEAT_MIN_WEIGHT = 0.25;

export type RatingInput = { userId: string; rating: number; ratedGames: number; rank: number };
export type RatingResult = { userId: string; newRating: number; delta: number; won: boolean };

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** `k` = rated games this pair already shared in the window. */
export const repeatWeight = (k: number) => Math.max(REPEAT_MIN_WEIGHT, 1 - REPEAT_STEP * k);

/**
 * Pairwise Elo for a free-for-all: every player is scored against every other as if they had played
 * head to head, then the sum is spread over the `n - 1` opponents so a big table can't swing a rating
 * further than a duel. Equal ranks tie (0.5). Pure: no I/O, no clock.
 */
export function computeRatings(
  players: readonly RatingInput[],
  repeatCounts: ReadonlyMap<string, number> = new Map(),
): RatingResult[] {
  const n = players.length;
  if (n < 2) return players.map((x) => ({ userId: x.userId, newRating: x.rating, delta: 0, won: false }));

  return players.map((me) => {
    const k = me.ratedGames < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
    let sum = 0;
    for (const other of players) {
      if (other.userId === me.userId) continue;
      const actual = me.rank < other.rank ? 1 : me.rank === other.rank ? 0.5 : 0;
      const expected = 1 / (1 + 10 ** ((other.rating - me.rating) / 400));
      const weight = repeatWeight(repeatCounts.get(pairKey(me.userId, other.userId)) ?? 0);
      sum += weight * (actual - expected);
    }
    const newRating = Math.max(RATING_FLOOR, me.rating + Math.round((k / (n - 1)) * sum));
    return { userId: me.userId, newRating, delta: newRating - me.rating, won: me.rank === 1 };
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/server/ratings/rating.test.ts`
Expected: PASS (8 tests). Leave uncommitted.

---

### Task 3: Database layer

**Files:**

- Create: `src/server/db/ratings.ts`, `tests/integration/ratings-helpers.ts`
- Test: `tests/integration/ratings-db.test.ts`

**Interfaces:**

- Consumes: `pairKey`, `REPEAT_WINDOW_HOURS` from `@/server/ratings/rating`.
- Produces (all take `db: Db` first):
  - `loadGameToRate(db, gameId): Promise<{ participants: { userId: string; rank: number }[] } | null>` (null when missing, not finished, or already rated; participants are distinct signed-in players with a rank)
  - `markUnratable(db, gameId, at: string): Promise<void>`
  - `ensureRatingRows(db, userIds: string[]): Promise<void>`
  - `loadRatings(db, userIds): Promise<Map<string, { rating: number; ratedGames: number; version: number }>>`
  - `loadRepeatCounts(db, gameId, userIds): Promise<Map<string, number>>` (keys from `pairKey`)
  - `type RatingUpdate = { userId: string; expectedVersion: number; ratingBefore: number; ratingAfter: number; won: boolean }`
  - `applyRatings(db, gameId, at: string, updates: RatingUpdate[]): Promise<boolean>` (true only if this call claimed the game and updated every player)
  - `listUnrated(db, limit): Promise<string[]>` (game ids, oldest first)
  - `type LeaderboardRow = { position: number; userId: string; handle: string | null; name: string | null; rating: number; ratedGames: number; wins: number }`
  - `queryLeaderboard(db, opts: { userIds: string[] | null; limit: number; meId: string | null }): Promise<LeaderboardRow[]>` (top `limit` plus the viewer's row)
  - `queryStats(db, userId): Promise<{ games: number; versusGames: number; wins: number; bestStreak: number; pairs: number; moves: number }>`
  - `queryRating(db, userId): Promise<{ rating: number; ratedGames: number; wins: number; position: number } | null>`

- [ ] **Step 1: Seed helpers**

Create `tests/integration/ratings-helpers.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { Db } from "@/server/db";

export type SeedPlayer = {
  userId: string | null;
  rank: number | null;
  pairs?: number;
  moves?: number;
  bestStreak?: number;
};

/** Inserts a game and its roster straight into the public tables. Returns the game id. */
export async function seedGame(
  db: Db,
  game: {
    code: string;
    status?: "lobby" | "playing" | "finished" | "abandoned";
    finishedAt?: string;
    players: SeedPlayer[];
  },
): Promise<string> {
  const id = randomUUID();
  const at = game.finishedAt ?? "2026-10-06T12:00:00Z";
  await db.query(
    `INSERT INTO games (id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, started_at, finished_at)
     VALUES ($1, $2, 'p0', '001', 8, 12, 20, $3, $4::timestamptz, $4::timestamptz)`,
    [id, game.code, game.status ?? "finished", at],
  );
  for (const [seat, player] of game.players.entries()) {
    await db.query(
      `INSERT INTO game_players (game_id, player_id, user_id, display_name, seat, moves, pairs, best_streak, rank)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        `p${seat}`,
        player.userId,
        `Player ${seat}`,
        seat,
        player.moves ?? 10,
        player.pairs ?? 4,
        player.bestStreak ?? 1,
        player.rank,
      ],
    );
  }
  return id;
}

export async function seedProfile(db: Db, userId: string, handle: string, name: string) {
  await db.query(
    `INSERT INTO profiles (user_id, handle, display_name, last_seen_at) VALUES ($1, $2, $3, now())`,
    [userId, handle, name],
  );
}

export async function seedRating(db: Db, userId: string, rating: number, ratedGames = 10, wins = 0) {
  await db.query(`INSERT INTO player_ratings (user_id, rating, rated_games, wins) VALUES ($1, $2, $3, $4)`, [
    userId,
    rating,
    ratedGames,
    wins,
  ]);
}

export async function ratingRow(db: Db, userId: string) {
  const rows = await db.query<{ rating: number; rated_games: number; wins: number; version: number }>(
    `SELECT rating, rated_games, wins, version FROM player_ratings WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function ratedAt(db: Db, gameId: string) {
  const rows = await db.query<{ rated_at: Date | null }>(`SELECT rated_at FROM games WHERE id = $1`, [
    gameId,
  ]);
  return rows[0]!.rated_at;
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/ratings-db.test.ts`:

```ts
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

const updates = (versionA = 0): RatingUpdate[] => [
  { userId: "alice", expectedVersion: versionA, ratingBefore: 1000, ratingAfter: 1016, won: true },
  { userId: "bob", expectedVersion: 0, ratingBefore: 1000, ratingAfter: 984, won: false },
];

describe("applyRatings", () => {
  it("changes nothing when a player's version is stale", async () => {
    const id = await seedGame(db, {
      code: "AAA234",
      players: [
        { userId: "alice", rank: 1 },
        { userId: "bob", rank: 2 },
      ],
    });
    await ensureRatingRows(db, ["alice", "bob"]);

    expect(await applyRatings(db, id, "2026-10-06T13:00:00Z", updates(7))).toBe(false);
    expect(await ratingRow(db, "alice")).toMatchObject({ rating: 1000, rated_games: 0, version: 0 });
    expect(await ratedAt(db, id)).toBeNull();
  });

  it("applies once: ratings, wins, version, per-game before/after and rated_at", async () => {
    const id = await seedGame(db, {
      code: "BBB234",
      players: [
        { userId: "alice", rank: 1 },
        { userId: "bob", rank: 2 },
      ],
    });
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
    expect(
      await applyRatings(
        db,
        id,
        "2026-10-06T13:05:00Z",
        updates(1).map((u) => ({ ...u, expectedVersion: 1 })),
      ),
    ).toBe(false);
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
    const gone = await seedGame(db, {
      code: "ABN234",
      status: "abandoned",
      players: [
        { userId: "a", rank: 1 },
        { userId: "b", rank: 2 },
      ],
    });
    expect(await loadGameToRate(db, lobby)).toBeNull();
    expect(await loadGameToRate(db, gone)).toBeNull();
    expect(await loadGameToRate(db, "00000000-0000-0000-0000-000000000000")).toBeNull();

    const done = await seedGame(db, {
      code: "DON234",
      players: [
        { userId: "a", rank: 1 },
        { userId: "b", rank: 2 },
      ],
    });
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
    const ranked = [
      { userId: "alice", rank: 1 },
      { userId: "bob", rank: 2 },
    ];
    const rate = async (id: string) => {
      await db.query(`UPDATE game_players SET rating_after = 1000 WHERE game_id = $1`, [id]);
    };
    const recent = await seedGame(db, {
      code: "REC234",
      finishedAt: "2026-10-06T10:00:00Z",
      players: ranked,
    });
    const old = await seedGame(db, { code: "OLD234", finishedAt: "2026-10-04T10:00:00Z", players: ranked });
    const unrated = await seedGame(db, {
      code: "UNR234",
      finishedAt: "2026-10-06T11:00:00Z",
      players: ranked,
    });
    const current = await seedGame(db, {
      code: "CUR234",
      finishedAt: "2026-10-06T12:00:00Z",
      players: ranked,
    });
    await rate(recent);
    await rate(old);
    void unrated;

    const counts = await loadRepeatCounts(db, current, ["alice", "bob"]);
    expect(counts.get(pairKey("alice", "bob"))).toBe(1);
  });
});

describe("listUnrated", () => {
  it("lists finished unrated games, oldest first, honouring the limit", async () => {
    const late = await seedGame(db, {
      code: "LAT234",
      finishedAt: "2026-10-06T12:00:00Z",
      players: [{ userId: "a", rank: 1 }],
    });
    const early = await seedGame(db, {
      code: "ERL234",
      finishedAt: "2026-10-06T08:00:00Z",
      players: [{ userId: "a", rank: 1 }],
    });
    const rated = await seedGame(db, {
      code: "RTD234",
      finishedAt: "2026-10-06T07:00:00Z",
      players: [{ userId: "a", rank: 1 }],
    });
    await markUnratable(db, rated, "2026-10-06T13:00:00Z");
    await seedGame(db, { code: "LOB234", status: "lobby", players: [{ userId: "a", rank: null }] });

    expect(await listUnrated(db, 10)).toEqual([early, late]);
    expect(await listUnrated(db, 1)).toEqual([early]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/integration/ratings-db.test.ts`
Expected: FAIL (module `@/server/db/ratings` not found).

- [ ] **Step 4: Implement the DB layer**

Create `src/server/db/ratings.ts`:

```ts
import "server-only";

import { z } from "zod";

import { pairKey, REPEAT_WINDOW_HOURS } from "@/server/ratings/rating";

import type { Db } from "./client";

const ids = (userIds: string[]) => JSON.stringify(userIds);

const gameRowSchema = z.object({ user_id: z.string().nullable(), rank: z.number().int().nullable() });

/** The signed-in, ranked players of a finished, not-yet-rated game; null if there is nothing to rate. */
export async function loadGameToRate(db: Db, gameId: string) {
  const rows = await db.query(
    `SELECT gp.user_id, gp.rank
       FROM games g
       LEFT JOIN game_players gp
         ON gp.game_id = g.id AND gp.user_id IS NOT NULL AND gp.rank IS NOT NULL
      WHERE g.id = $1 AND g.status = 'finished' AND g.rated_at IS NULL`,
    [gameId],
  );
  if (rows.length === 0) return null;
  const participants = new Map<string, number>();
  for (const raw of rows) {
    const row = gameRowSchema.parse(raw);
    if (row.user_id !== null && row.rank !== null) participants.set(row.user_id, row.rank);
  }
  return { participants: [...participants].map(([userId, rank]) => ({ userId, rank })) };
}

/** A finished game with nothing to rate (guests only, a solo game): mark it so the sweeper skips it. */
export async function markUnratable(db: Db, gameId: string, at: string) {
  await db.query(
    `UPDATE games SET rated_at = $2::timestamptz WHERE id = $1 AND status = 'finished' AND rated_at IS NULL`,
    [gameId, at],
  );
}

export async function ensureRatingRows(db: Db, userIds: string[]) {
  await db.query(
    `INSERT INTO player_ratings (user_id)
     SELECT jsonb_array_elements_text($1::jsonb)
     ON CONFLICT (user_id) DO NOTHING`,
    [ids(userIds)],
  );
}

const ratingRowSchema = z.object({
  user_id: z.string(),
  rating: z.number().int(),
  rated_games: z.number().int(),
  version: z.number().int(),
});

export async function loadRatings(db: Db, userIds: string[]) {
  const rows = await db.query(
    `SELECT user_id, rating, rated_games, version FROM player_ratings
      WHERE user_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,
    [ids(userIds)],
  );
  return new Map(
    rows.map((raw) => {
      const r = ratingRowSchema.parse(raw);
      return [r.user_id, { rating: r.rating, ratedGames: r.rated_games, version: r.version }] as const;
    }),
  );
}

/** How many rated games each pair among `userIds` shared in the window before this game finished. */
export async function loadRepeatCounts(db: Db, gameId: string, userIds: string[]) {
  const rows = await db.query<{ a: string; b: string; n: number }>(
    `SELECT a.user_id AS a, b.user_id AS b, count(*)::int AS n
       FROM games cur
       JOIN games g ON g.id <> cur.id AND g.status = 'finished'
                   AND g.finished_at <= cur.finished_at
                   AND g.finished_at > cur.finished_at - ($3::int * interval '1 hour')
       JOIN game_players a ON a.game_id = g.id AND a.rating_after IS NOT NULL
       JOIN game_players b ON b.game_id = g.id AND b.rating_after IS NOT NULL AND a.user_id < b.user_id
      WHERE cur.id = $1
        AND a.user_id IN (SELECT jsonb_array_elements_text($2::jsonb))
        AND b.user_id IN (SELECT jsonb_array_elements_text($2::jsonb))
      GROUP BY a.user_id, b.user_id`,
    [gameId, ids(userIds), REPEAT_WINDOW_HOURS],
  );
  return new Map(rows.map((r) => [pairKey(r.a, r.b), Number(r.n)] as const));
}

export type RatingUpdate = {
  userId: string;
  expectedVersion: number;
  ratingBefore: number;
  ratingAfter: number;
  won: boolean;
};

/**
 * Claims the game and applies every player's new rating in ONE statement. `ok` locks the player rows
 * (FOR UPDATE) and counts how many still have the version we read; if any moved, nothing is claimed
 * and nothing is written, so the caller re-reads and retries. A game already rated is never claimed
 * twice. Returns true only when this call claimed the game.
 */
export async function applyRatings(db: Db, gameId: string, at: string, updates: RatingUpdate[]) {
  const input = updates.map((u) => ({
    user_id: u.userId,
    expected_version: u.expectedVersion,
    rating_before: u.ratingBefore,
    rating_after: u.ratingAfter,
    won: u.won,
  }));
  const rows = await db.query<{ claimed: number }>(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb)
         AS x(user_id text, expected_version int, rating_before int, rating_after int, won boolean)
     ), ok AS (
       SELECT count(*) = (SELECT count(*) FROM input) AS ok
         FROM (SELECT 1 FROM player_ratings p JOIN input i ON i.user_id = p.user_id
                WHERE p.version = i.expected_version FOR UPDATE OF p) locked
     ), claim AS (
       UPDATE games SET rated_at = $2::timestamptz
        WHERE id = $1 AND status = 'finished' AND rated_at IS NULL AND (SELECT ok FROM ok)
       RETURNING id
     ), upd AS (
       UPDATE player_ratings pr
          SET rating = i.rating_after, rated_games = pr.rated_games + 1,
              wins = pr.wins + CASE WHEN i.won THEN 1 ELSE 0 END,
              version = pr.version + 1, updated_at = $2::timestamptz
         FROM input i
        WHERE pr.user_id = i.user_id AND pr.version = i.expected_version AND EXISTS (SELECT 1 FROM claim)
       RETURNING pr.user_id
     ), gp AS (
       UPDATE game_players g SET rating_before = i.rating_before, rating_after = i.rating_after
         FROM input i
        WHERE g.game_id = $1 AND g.user_id = i.user_id AND EXISTS (SELECT 1 FROM claim)
       RETURNING g.user_id
     )
     SELECT (SELECT count(*) FROM claim)::int AS claimed`,
    [gameId, at, JSON.stringify(input)],
  );
  return Number(rows[0]?.claimed) === 1;
}

/** Finished games nobody rated yet, oldest first. */
export async function listUnrated(db: Db, limit: number) {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM games
      WHERE status = 'finished' AND rated_at IS NULL
      ORDER BY finished_at NULLS FIRST, id
      LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.id);
}

const leaderboardRowSchema = z.object({
  position: z.number().int(),
  user_id: z.string(),
  handle: z.string().nullable(),
  display_name: z.string().nullable(),
  rating: z.number().int(),
  rated_games: z.number().int(),
  wins: z.number().int(),
});

export type LeaderboardRow = {
  position: number;
  userId: string;
  handle: string | null;
  name: string | null;
  rating: number;
  ratedGames: number;
  wins: number;
};

/** Top `limit` plus the viewer's own row. `userIds: null` is the global board. */
export async function queryLeaderboard(
  db: Db,
  opts: { userIds: string[] | null; limit: number; meId: string | null },
): Promise<LeaderboardRow[]> {
  const rows = await db.query(
    `WITH ranked AS (
       SELECT pr.user_id, pr.rating, pr.rated_games, pr.wins, p.handle, p.display_name,
              (row_number() OVER (ORDER BY pr.rating DESC, pr.rated_games DESC, pr.user_id))::int AS position
         FROM player_ratings pr
         LEFT JOIN profiles p ON p.user_id = pr.user_id
        WHERE $1::jsonb IS NULL OR pr.user_id IN (SELECT jsonb_array_elements_text($1::jsonb))
     )
     SELECT * FROM ranked WHERE position <= $2::int OR user_id = $3::text ORDER BY position`,
    [opts.userIds === null ? null : ids(opts.userIds), opts.limit, opts.meId],
  );
  return rows.map((raw) => {
    const r = leaderboardRowSchema.parse(raw);
    return {
      position: r.position,
      userId: r.user_id,
      handle: r.handle,
      name: r.display_name,
      rating: r.rating,
      ratedGames: r.rated_games,
      wins: r.wins,
    };
  });
}

const statsRowSchema = z.object({
  games: z.number().int(),
  versus_games: z.number().int(),
  wins: z.number().int(),
  best_streak: z.number().int(),
  pairs: z.number().int(),
  moves: z.number().int(),
});

/** Lifetime numbers for a signed-in user, from finished games (casual ones included). */
export async function queryStats(db: Db, userId: string) {
  const rows = await db.query(
    `WITH mine AS (
       SELECT gp.rank, gp.best_streak, gp.pairs, gp.moves,
              (SELECT count(*) FROM game_players o WHERE o.game_id = gp.game_id) AS seated
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'finished'
     )
     SELECT count(*)::int AS games,
            (count(*) FILTER (WHERE seated >= 2))::int AS versus_games,
            (count(*) FILTER (WHERE seated >= 2 AND rank = 1))::int AS wins,
            coalesce(max(best_streak), 0)::int AS best_streak,
            coalesce(sum(pairs), 0)::int AS pairs,
            coalesce(sum(moves), 0)::int AS moves
       FROM mine`,
    [userId],
  );
  const r = statsRowSchema.parse(rows[0]);
  return {
    games: r.games,
    versusGames: r.versus_games,
    wins: r.wins,
    bestStreak: r.best_streak,
    pairs: r.pairs,
    moves: r.moves,
  };
}

const myRatingSchema = z.object({
  rating: z.number().int(),
  rated_games: z.number().int(),
  wins: z.number().int(),
  position: z.number().int(),
});

export async function queryRating(db: Db, userId: string) {
  const rows = await db.query(
    `SELECT me.rating, me.rated_games, me.wins,
            ((SELECT count(*) FROM player_ratings o
               WHERE o.rating > me.rating
                  OR (o.rating = me.rating AND (o.rated_games > me.rated_games
                      OR (o.rated_games = me.rated_games AND o.user_id < me.user_id)))) + 1)::int AS position
       FROM player_ratings me WHERE me.user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const r = myRatingSchema.parse(rows[0]);
  return { rating: r.rating, ratedGames: r.rated_games, wins: r.wins, position: r.position };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run tests/integration/ratings-db.test.ts`
Expected: PASS. If a query fails on a parameter type, add the cast shown in the SQL above rather than changing the structure. Leave uncommitted.

---

### Task 4: `FriendsService.friendIds`

**Files:**

- Modify: `src/server/friends/service.ts` (add method after `list`)
- Test: `tests/integration/friends-service.test.ts` (add a `describe`)

**Interfaces:**

- Produces: `FriendsService.friendIds(userId: string): Promise<string[]>`, accepted friends only.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/friends-service.test.ts`:

```ts
describe("friendIds", () => {
  it("lists accepted friends only", async () => {
    const aliceHandle = await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.touch(carol);
    await friends.request(alice, bobHandle);
    await friends.accept(bob, alice.id);
    await friends.request(carol, aliceHandle);

    expect(await friends.friendIds(alice.id)).toEqual(["bob"]);
    expect(await friends.friendIds(bob.id)).toEqual(["alice"]);
    expect(await friends.friendIds(carol.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/integration/friends-service.test.ts -t friendIds`
Expected: FAIL (`friendIds is not a function`).

- [ ] **Step 3: Implement**

In `src/server/friends/service.ts`, after the `list` method:

```ts
  /** Ids of accepted friends, for features (leaderboards) that need the set but not the details. */
  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.db.query<{ friend: string }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend
         FROM friendships
        WHERE status = 'accepted' AND (user_a = $1 OR user_b = $1)`,
      [userId],
    );
    return rows.map((r) => r.friend);
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/integration/friends-service.test.ts`
Expected: PASS. Leave uncommitted.

---

### Task 5: `RatingsService`

**Files:**

- Create: `src/server/ratings/service.ts`, `src/server/ratings/index.ts`
- Modify: `src/lib/protocol/index.ts` (add the response types now; later tasks import them)
- Test: `tests/integration/ratings-service.test.ts`

**Interfaces:**

- Consumes: everything from Task 3, `computeRatings`/`pairKey` from Task 2, `FriendsService.friendIds` from Task 4, `ServiceError` from `@/server/tables/service`.
- Produces:
  - protocol: `LeaderboardEntry = { rank: number; handle: string | null; name: string; rating: number; ratedGames: number; wins: number; isYou: boolean }`; `LeaderboardResponse = { scope: "global" | "friends"; entries: LeaderboardEntry[]; me: LeaderboardEntry | null }`; `StatsResponse = { games: number; versusGames: number; wins: number; winRate: number | null; bestStreak: number; accuracy: number | null; rating: { value: number; ratedGames: number; rank: number } | null }`
  - `interface FriendIds { friendIds(userId: string): Promise<string[]> }`
  - `class RatingsService(db: Db, options: { clock?: () => number; friends: FriendIds })` with `rateGame(gameId): Promise<boolean>`, `rateFinishedTable(code): Promise<void>`, `sweepUnrated(limit): Promise<{ rated: number }>`, `leaderboard(scope, viewerId: string | null, limit = 50): Promise<LeaderboardResponse>`, `statsFor(userId): Promise<StatsResponse>`
  - `getRatingsService(): Promise<RatingsService>`

- [ ] **Step 1: Add the protocol types**

In `src/lib/protocol/index.ts`, after `HistoryEntry`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/integration/ratings-service.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/server/db";
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/integration/ratings-service.test.ts`
Expected: FAIL (module `@/server/ratings/service` not found).

- [ ] **Step 4: Implement the service**

Create `src/server/ratings/service.ts`:

```ts
import "server-only";

import type { LeaderboardEntry, LeaderboardResponse, LeaderboardScope, StatsResponse } from "@/lib/protocol";
import type { Db } from "@/server/db";
import {
  applyRatings,
  ensureRatingRows,
  listUnrated,
  loadGameToRate,
  loadRatings,
  loadRepeatCounts,
  markUnratable,
  queryLeaderboard,
  queryRating,
  queryStats,
  type LeaderboardRow,
} from "@/server/db/ratings";
import { ServiceError } from "@/server/tables/service";

import { computeRatings } from "./rating";

const MAX_ATTEMPTS = 5;
const DEFAULT_BOARD_SIZE = 50;

/** What ratings needs to know about friendships. `FriendsService` implements it. */
export interface FriendIds {
  friendIds(userId: string): Promise<string[]>;
}

type Options = { clock?: () => number; friends: FriendIds };

export class RatingsService {
  private readonly clock: () => number;
  private readonly friends: FriendIds;

  constructor(
    private readonly db: Db,
    options: Options,
  ) {
    this.clock = options.clock ?? Date.now;
    this.friends = options.friends;
  }

  /** Rates one finished game. True if this call applied it; false if there was nothing to do. Idempotent. */
  async rateGame(gameId: string): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const game = await loadGameToRate(this.db, gameId);
      if (!game) return false;

      const at = new Date(this.clock()).toISOString();
      if (game.participants.length < 2) {
        await markUnratable(this.db, gameId, at);
        return false;
      }

      const userIds = game.participants.map((p) => p.userId);
      await ensureRatingRows(this.db, userIds);
      const [current, repeats] = await Promise.all([
        loadRatings(this.db, userIds),
        loadRepeatCounts(this.db, gameId, userIds),
      ]);

      const results = computeRatings(
        game.participants.map((p) => {
          const c = current.get(p.userId)!;
          return { userId: p.userId, rank: p.rank, rating: c.rating, ratedGames: c.ratedGames };
        }),
        repeats,
      );
      const applied = await applyRatings(
        this.db,
        gameId,
        at,
        results.map((r) => {
          const c = current.get(r.userId)!;
          return {
            userId: r.userId,
            expectedVersion: c.version,
            ratingBefore: c.rating,
            ratingAfter: r.newRating,
            won: r.won,
          };
        }),
      );
      if (applied) return true;
    }
    throw new ServiceError("conflict", "Ratings are busy, try again");
  }

  async rateFinishedTable(code: string): Promise<void> {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM games WHERE code = $1`, [code]);
    if (rows[0]) await this.rateGame(rows[0].id);
  }

  /** Backstop for games whose after-response rating never ran. Sequential: games share players. */
  async sweepUnrated(limit: number): Promise<{ rated: number }> {
    let rated = 0;
    for (const id of await listUnrated(this.db, limit)) {
      try {
        if (await this.rateGame(id)) rated++;
      } catch (error) {
        console.error("rating sweep failed for a game", error);
      }
    }
    return { rated };
  }

  async leaderboard(
    scope: LeaderboardScope,
    viewerId: string | null,
    limit = DEFAULT_BOARD_SIZE,
  ): Promise<LeaderboardResponse> {
    let userIds: string[] | null = null;
    if (scope === "friends") {
      if (!viewerId) throw new ServiceError("unauthorized", "Sign in to see your friends' ranking");
      userIds = [...(await this.friends.friendIds(viewerId)), viewerId];
    }
    const rows = await queryLeaderboard(this.db, { userIds, limit, meId: viewerId });
    const toEntry = (r: LeaderboardRow): LeaderboardEntry => ({
      rank: r.position,
      handle: r.handle,
      name: r.name ?? "Player",
      rating: r.rating,
      ratedGames: r.ratedGames,
      wins: r.wins,
      isYou: r.userId === viewerId,
    });
    const me = rows.find((r) => r.userId === viewerId);
    return {
      scope,
      entries: rows.filter((r) => r.position <= limit).map(toEntry),
      me: me ? toEntry(me) : null,
    };
  }

  async statsFor(userId: string): Promise<StatsResponse> {
    const [stats, rating] = await Promise.all([queryStats(this.db, userId), queryRating(this.db, userId)]);
    return {
      games: stats.games,
      versusGames: stats.versusGames,
      wins: stats.wins,
      winRate: stats.versusGames > 0 ? stats.wins / stats.versusGames : null,
      bestStreak: stats.bestStreak,
      accuracy: stats.moves > 0 ? stats.pairs / stats.moves : null,
      rating: rating ? { value: rating.rating, ratedGames: rating.ratedGames, rank: rating.position } : null,
    };
  }
}
```

Create `src/server/ratings/index.ts`:

```ts
import "server-only";

import { getDb } from "@/server/db";
import { getFriendsService } from "@/server/friends";

import { RatingsService } from "./service";

export * from "./service";

let service: Promise<RatingsService> | undefined;

export function getRatingsService(): Promise<RatingsService> {
  service ??= Promise.all([getDb(), getFriendsService()]).then(
    ([db, friends]) => new RatingsService(db, { friends }),
  );
  return service;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run tests/integration/ratings-service.test.ts`
Expected: PASS. If the leaderboard order differs for equal ratings, the tiebreak is `rated_games DESC, user_id` (already in the SQL). Leave uncommitted.

---

### Task 6: Triggers (after the response, and the cron)

**Files:**

- Create: `src/server/ratings/after.ts`
- Modify: `src/server/actions.ts`, `src/app/api/cron/cleanup/route.ts`
- Test: `src/server/ratings/after.test.ts`

**Interfaces:**

- Consumes: `getRatingsService` (Task 5).
- Produces: `rateAfterResponse(code: string): void`, never throws.

- [ ] **Step 1: Read the `after` docs**

Read `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`. Confirm `after` is exported from `next/server` and runs after the response in route handlers.

- [ ] **Step 2: Write the failing test**

Create `src/server/ratings/after.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const rateFinishedTable = vi.fn();
vi.mock("./index", () => ({ getRatingsService: async () => ({ rateFinishedTable }) }));
const afterMock = vi.fn();
vi.mock("next/server", () => ({ after: (fn: () => unknown) => afterMock(fn) }));

import { rateAfterResponse } from "./after";

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("rateAfterResponse", () => {
  it("schedules the rating with after() and rates the table when it runs", async () => {
    afterMock.mockImplementation(() => undefined);
    rateAfterResponse("ABC234");
    expect(afterMock).toHaveBeenCalledTimes(1);
    await afterMock.mock.calls[0]![0]();
    expect(rateFinishedTable).toHaveBeenCalledWith("ABC234");
  });

  it("runs the rating anyway when after() is unavailable (outside a request)", async () => {
    afterMock.mockImplementation(() => {
      throw new Error("after was called outside a request scope");
    });
    rateAfterResponse("ABC234");
    await vi.waitFor(() => expect(rateFinishedTable).toHaveBeenCalledWith("ABC234"));
  });

  it("logs and swallows a rating failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rateFinishedTable.mockRejectedValueOnce(new Error("db down"));
    afterMock.mockImplementation(() => undefined);
    rateAfterResponse("ABC234");
    await expect(afterMock.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/server/ratings/after.test.ts`
Expected: FAIL (module `./after` not found).

- [ ] **Step 4: Implement**

Create `src/server/ratings/after.ts`:

```ts
import "server-only";

import { after } from "next/server";

import { getRatingsService } from "./index";

/**
 * Rates a table that just finished, after the response has gone out so players never wait on it.
 * Best effort: a failure is logged and the daily cron sweep picks the game up later.
 */
export function rateAfterResponse(code: string): void {
  const run = async () => {
    try {
      await (await getRatingsService()).rateFinishedTable(code);
    } catch (error) {
      console.error("rating after game end failed", error);
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
```

- [ ] **Step 5: Wire `playerAction`**

In `src/server/actions.ts` add `import { rateAfterResponse } from "@/server/ratings/after";` and replace the response block:

```ts
const snapshot = await service.act(code, identity, action, sinceParam(request));
if (snapshot.view.status === "finished") rateAfterResponse(code);
return NextResponse.json<SnapshotResponse>(snapshot);
```

- [ ] **Step 6: Wire the cron**

In `src/app/api/cron/cleanup/route.ts` add `import { getRatingsService } from "@/server/ratings";`, update the doc comment ("also rates games whose after-response rating never ran"), and replace the `Promise.all` and response:

```ts
const [tables, invites, ratings] = await Promise.all([
  cleanupTables(await getDb(), Date.now()),
  (await getFriendsService()).cleanup(),
  (await getRatingsService()).sweepUnrated(200),
]);
return NextResponse.json({ ...tables, ...invites, ...ratings });
```

- [ ] **Step 7: Run tests, typecheck**

Run: `pnpm vitest run src/server/ratings/after.test.ts && pnpm typecheck && pnpm test`
Expected: PASS. Leave uncommitted.

---

### Task 7: API routes and history rating fields

**Files:**

- Create: `src/app/api/leaderboard/route.ts`, `src/app/api/me/stats/route.ts`
- Modify: `src/lib/protocol/index.ts` (`HistoryEntry.you`), `src/server/db/history.ts`
- Test: `tests/integration/ratings-routes.test.ts`, extend `tests/integration/ratings-service.test.ts`

**Interfaces:**

- Consumes: `getRatingsService`, `LeaderboardResponse`, `StatsResponse` (Task 5).
- Produces: `GET /api/leaderboard?scope=global|friends` → `LeaderboardResponse`; `GET /api/me/stats` → `StatsResponse`; `HistoryEntry.you.ratingBefore` and `ratingAfter` (`number | null`).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/ratings-routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET as leaderboard } from "@/app/api/leaderboard/route";
import { GET as stats } from "@/app/api/me/stats/route";

const ctx = { params: Promise.resolve({}) };

describe("ratings routes", () => {
  it("answer 401 to guests for stats and for the friends leaderboard", async () => {
    const mine = await stats(new Request("http://x/api/me/stats"), ctx);
    expect(mine.status).toBe(401);
    const friends = await leaderboard(new Request("http://x/api/leaderboard?scope=friends"), ctx);
    expect(friends.status).toBe(401);
    expect(await friends.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects an unknown scope", async () => {
    const response = await leaderboard(new Request("http://x/api/leaderboard?scope=everyone"), ctx);
    expect(response.status).toBe(400);
  });
});
```

Append to `tests/integration/ratings-service.test.ts` (add `import { listHistory } from "@/server/db/history";` at the top):

```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/integration/ratings-routes.test.ts tests/integration/ratings-service.test.ts`
Expected: FAIL (route modules not found; history lacks fields).

- [ ] **Step 3: History fields**

In `src/lib/protocol/index.ts` change `HistoryEntry.you` to:

```ts
you: {
  pairs: number;
  moves: number;
  bestStreak: number;
  rank: number | null;
  /** Null until the game is rated, and for games that are never rated. */
  ratingBefore: number | null;
  ratingAfter: number | null;
}
```

In `src/server/db/history.ts`: add `rating_before: z.number().int().nullable(), rating_after: z.number().int().nullable(),` to the player object in `historyRowSchema`; add `'rating_before', o.rating_before, 'rating_after', o.rating_after` to the `jsonb_build_object(...)`; and change the `you` mapping to:

```ts
      you: {
        pairs: me.pairs,
        moves: me.moves,
        bestStreak: me.best_streak,
        rank: me.rank,
        ratingBefore: me.rating_before,
        ratingAfter: me.rating_after,
      },
```

- [ ] **Step 4: Routes**

Create `src/app/api/leaderboard/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import type { LeaderboardResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getRatingsService } from "@/server/ratings";
import { ServiceError } from "@/server/tables";

const scopeSchema = z.enum(["global", "friends"]).default("global");

/** The global board is public; the friends board needs an account. Never returns user ids. */
export const GET = route(async (request) => {
  const scope = scopeSchema.parse(new URL(request.url).searchParams.get("scope") ?? undefined);
  const user = await getAccountUser();
  if (scope === "friends" && !user) {
    throw new ServiceError("unauthorized", "Sign in to see your friends' ranking");
  }
  const ratings = await getRatingsService();
  return NextResponse.json<LeaderboardResponse>(await ratings.leaderboard(scope, user?.id ?? null));
});
```

Create `src/app/api/me/stats/route.ts`:

```ts
import { NextResponse } from "next/server";

import type { StatsResponse } from "@/lib/protocol";
import { getAccountUser } from "@/server/auth";
import { route } from "@/server/http";
import { getRatingsService } from "@/server/ratings";
import { ServiceError } from "@/server/tables";

export const GET = route(async () => {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to see your stats");
  return NextResponse.json<StatsResponse>(await (await getRatingsService()).statsFor(user.id));
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/integration && pnpm typecheck`
Expected: PASS (fix any existing test that does an exact `toEqual` on `you`). Leave uncommitted.

---

### Task 8: Client API and the stats panel on `/profile`

**Files:**

- Modify: `src/lib/client/api.ts`, `src/components/Profile.tsx`, `src/components/Profile.test.tsx`, `src/app/globals.css`
- Create: `src/components/StatsPanel.tsx`
- Test: `src/components/StatsPanel.test.tsx`, `src/components/Profile.test.tsx`

**Interfaces:**

- Consumes: `StatsResponse`, `LeaderboardResponse`, `LeaderboardScope`.
- Produces: `api.leaderboard(scope: LeaderboardScope): Promise<LeaderboardResponse>`, `api.stats(): Promise<StatsResponse>`, `<StatsPanel stats={StatsResponse} />`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/StatsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { StatsResponse } from "@/lib/protocol";

import { StatsPanel } from "./StatsPanel";

afterEach(cleanup);

const stats: StatsResponse = {
  games: 12,
  versusGames: 10,
  wins: 4,
  winRate: 0.4,
  bestStreak: 6,
  accuracy: 0.5,
  rating: { value: 1087, ratedGames: 9, rank: 3 },
};

describe("StatsPanel", () => {
  it("shows the rating, rank and the lifetime numbers", () => {
    render(<StatsPanel stats={stats} />);
    const panel = within(screen.getByTestId("stats"));
    expect(panel.getByText("1087")).toBeInTheDocument();
    expect(panel.getByText("#3")).toBeInTheDocument();
    expect(panel.getByText("4 of 10")).toBeInTheDocument();
    expect(panel.getByText("40%")).toBeInTheDocument();
    expect(panel.getByText("50%")).toBeInTheDocument();
    expect(panel.getByText("6")).toBeInTheDocument();
  });

  it("copes with a player who has no rated or versus games", () => {
    render(
      <StatsPanel
        stats={{
          games: 0,
          versusGames: 0,
          wins: 0,
          winRate: null,
          bestStreak: 0,
          accuracy: null,
          rating: null,
        }}
      />,
    );
    const panel = within(screen.getByTestId("stats"));
    expect(panel.getByText("Unrated")).toBeInTheDocument();
    expect(panel.getAllByText("–").length).toBeGreaterThanOrEqual(2);
  });
});
```

In `src/components/Profile.test.tsx` add `vi.spyOn(api, "stats").mockResolvedValue({ games: 0, versusGames: 0, wins: 0, winRate: null, bestStreak: 0, accuracy: null, rating: null });` to `beforeEach`, and add these tests inside the `describe`:

```tsx
it("shows the stats panel above friends for a signed-in user", async () => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: "a@example.com", image: null },
  });
  render(<Profile />);
  const stats = await screen.findByTestId("stats");
  const friends = screen.getByRole("heading", { name: "Friends" });
  expect(stats.compareDocumentPosition(friends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("still renders the profile when stats fail to load", async () => {
  vi.spyOn(api, "stats").mockRejectedValue(new Error("boom"));
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: "a@example.com", image: null },
  });
  render(<Profile />);
  expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
  expect(screen.queryByTestId("stats")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/components/StatsPanel.test.tsx src/components/Profile.test.tsx`
Expected: FAIL (`StatsPanel` missing, `api.stats` missing).

- [ ] **Step 3: Client API**

In `src/lib/client/api.ts` add `LeaderboardResponse, LeaderboardScope, StatsResponse` to the type import and these entries to `api` (after `history`):

```ts
  stats: () => request<StatsResponse>("/api/me/stats"),
  leaderboard: (scope: LeaderboardScope) => request<LeaderboardResponse>(`/api/leaderboard?scope=${scope}`),
```

- [ ] **Step 4: StatsPanel**

Create `src/components/StatsPanel.tsx`:

```tsx
import type { StatsResponse } from "@/lib/protocol";

const percent = (value: number | null) => (value === null ? "–" : `${Math.round(value * 100)}%`);

export function StatsPanel({ stats }: { stats: StatsResponse }) {
  return (
    <section className="stats" aria-labelledby="stats-heading">
      <h2 id="stats-heading">Your record</h2>
      <dl data-testid="stats">
        <div>
          <dt>Rating</dt>
          <dd>{stats.rating ? stats.rating.value : "Unrated"}</dd>
          {stats.rating && <dd className="hint">#{stats.rating.rank}</dd>}
        </div>
        <div>
          <dt>Games</dt>
          <dd>{stats.games}</dd>
        </div>
        <div>
          <dt>Wins</dt>
          <dd>{stats.versusGames > 0 ? `${stats.wins} of ${stats.versusGames}` : "–"}</dd>
        </div>
        <div>
          <dt>Win rate</dt>
          <dd>{percent(stats.winRate)}</dd>
        </div>
        <div>
          <dt>Best run</dt>
          <dd>{stats.bestStreak}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{percent(stats.accuracy)}</dd>
        </div>
      </dl>
    </section>
  );
}
```

- [ ] **Step 5: Profile**

In `src/components/Profile.tsx`: import `StatsPanel` and `StatsResponse`; add `const [stats, setStats] = useState<StatsResponse | null>(null);`; in the `useEffect` add `api.stats().then(setStats, () => setStats(null));` next to the history call; render `{stats && <StatsPanel stats={stats} />}` immediately before `<FriendsPanel />`. In each history `<li>`, after the "pairs in moves" span, add:

```tsx
{
  game.you.ratingBefore !== null && game.you.ratingAfter !== null && (
    <span>
      Rating {game.you.ratingBefore} → {game.you.ratingAfter}
    </span>
  );
}
```

- [ ] **Step 6: Styles**

Append to `src/app/globals.css`:

```css
/* ------------------------------------------------------------ stats, leaderboard */
.stats dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.75rem;
  margin: 0 0 1.5rem;
}
.stats dl > div {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.6rem 0.8rem;
}
.stats dt {
  color: var(--ink-soft);
  font-size: 0.8rem;
}
.stats dd {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--ink);
}
.stats dd.hint {
  font-size: 0.85rem;
  font-weight: 400;
}
.leaderboard-tabs {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.leaderboard table {
  width: 100%;
  border-collapse: collapse;
}
.leaderboard th,
.leaderboard td {
  text-align: left;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--line);
}
.leaderboard tr.you {
  background: var(--signal);
  color: var(--on-signal);
}
.rating-change {
  font-weight: 600;
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run src/components && pnpm typecheck`
Expected: PASS. Leave uncommitted.

---

### Task 9: Leaderboard page and header link

**Files:**

- Create: `src/components/Leaderboard.tsx`, `src/app/leaderboard/page.tsx`
- Modify: `src/components/SiteHeader.tsx`
- Test: `src/components/Leaderboard.test.tsx`

**Interfaces:**

- Consumes: `api.leaderboard`, `useMe`, `LeaderboardResponse`.
- Produces: `<Leaderboard />`, route `/leaderboard`.

- [ ] **Step 1: Write the failing test**

Create `src/components/Leaderboard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { LeaderboardEntry, LeaderboardResponse } from "@/lib/protocol";

import { Leaderboard } from "./Leaderboard";

const entry = (rank: number, name: string, extra: Partial<LeaderboardEntry> = {}): LeaderboardEntry => ({
  rank,
  handle: name.toLowerCase(),
  name,
  rating: 1200 - rank * 10,
  ratedGames: 3,
  wins: 1,
  isYou: false,
  ...extra,
});
const board = (entries: LeaderboardEntry[], me: LeaderboardEntry | null = null): LeaderboardResponse => ({
  scope: "global",
  entries,
  me,
});
const signedIn = () =>
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });

beforeEach(() => signedIn());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Leaderboard", () => {
  it("lists players and highlights the viewer's row", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(
      board([entry(1, "Zed"), entry(2, "Alice", { isYou: true })], entry(2, "Alice", { isYou: true })),
    );
    render(<Leaderboard />);
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3); // header + 2
    expect(within(rows[2]!).getByText("Alice")).toBeInTheDocument();
    expect(rows[2]).toHaveClass("you");
  });

  it("pins the viewer's row when it is outside the list", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(
      board([entry(1, "Zed")], entry(57, "Alice", { isYou: true })),
    );
    render(<Leaderboard />);
    const pinned = await screen.findByTestId("my-row");
    expect(within(pinned).getByText("57")).toBeInTheDocument();
  });

  it("says so when nobody is rated yet", async () => {
    vi.spyOn(api, "leaderboard").mockResolvedValue(board([]));
    render(<Leaderboard />);
    expect(await screen.findByText(/No rated games yet/)).toBeInTheDocument();
  });

  it("loads the friends scope when the tab is chosen, and hides it from guests", async () => {
    const spy = vi.spyOn(api, "leaderboard").mockResolvedValue(board([entry(1, "Zed")]));
    render(<Leaderboard />);
    await screen.findByText("Zed");
    fireEvent.click(screen.getByRole("button", { name: "Friends" }));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith("friends"));

    cleanup();
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    render(<Leaderboard />);
    await screen.findByText("Zed");
    expect(screen.queryByRole("button", { name: "Friends" })).not.toBeInTheDocument();
  });

  it("shows an error when the board cannot be loaded", async () => {
    vi.spyOn(api, "leaderboard").mockRejectedValue(new Error("boom"));
    render(<Leaderboard />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/Leaderboard.test.tsx`
Expected: FAIL (component not found).

- [ ] **Step 3: Component and page**

Create `src/components/Leaderboard.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { useMe } from "@/lib/client/use-me";
import type { LeaderboardEntry, LeaderboardResponse, LeaderboardScope } from "@/lib/protocol";

function Row({ entry, testId }: { entry: LeaderboardEntry; testId?: string }) {
  return (
    <tr className={entry.isYou ? "you" : undefined} data-testid={testId}>
      <td>{entry.rank}</td>
      <td>
        {entry.name} {entry.handle && <span className="hint">@{entry.handle}</span>}
      </td>
      <td>{entry.rating}</td>
      <td>{entry.ratedGames}</td>
      <td>{entry.wins}</td>
    </tr>
  );
}

export function Leaderboard() {
  const me = useMe();
  const [scope, setScope] = useState<LeaderboardScope>("global");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBoard(null);
    setFailed(false);
    api.leaderboard(scope).then(
      (data) => !cancelled && setBoard(data),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const pinned = board?.me && !board.entries.some((e) => e.isYou) ? board.me : null;

  return (
    <section className="leaderboard">
      <h1>Leaderboard</h1>
      {me?.user && (
        <div className="leaderboard-tabs">
          {(["global", "friends"] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={s === scope ? "button" : "button secondary"}
              aria-pressed={s === scope}
              onClick={() => setScope(s)}
            >
              {s === "global" ? "Everyone" : "Friends"}
            </button>
          ))}
        </div>
      )}
      {failed ? (
        <p role="alert">We couldn&apos;t load the leaderboard. Try again in a moment.</p>
      ) : board === null ? (
        <p className="notice">Loading…</p>
      ) : board.entries.length === 0 ? (
        <p>No rated games yet. Finish a game with another signed-in player to get on the board.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Rating</th>
              <th scope="col">Games</th>
              <th scope="col">Wins</th>
            </tr>
          </thead>
          <tbody>
            {board.entries.map((e) => (
              <Row key={e.rank} entry={e} />
            ))}
            {pinned && <Row entry={pinned} testId="my-row" />}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

Note: the test above clicks a button named "Friends", so label the two tabs "Everyone" and "Friends" exactly as written.

Create `src/app/leaderboard/page.tsx`:

```tsx
import { Leaderboard } from "@/components/Leaderboard";

export const metadata = { title: "Leaderboard · Matching Pairs" };

export default function LeaderboardPage() {
  return (
    <main className="page page-narrow">
      <Leaderboard />
    </main>
  );
}
```

- [ ] **Step 4: Header link**

In `src/components/SiteHeader.tsx` replace the `<nav aria-label="Account">` contents with:

```tsx
{
  me?.authEnabled && (
    <>
      <Link href="/leaderboard">Leaderboard</Link>
      {me.user ? <Link href="/profile">{me.user.name}</Link> : <Link href="/auth/sign-in">Sign in</Link>}
    </>
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run src/components && pnpm lint && pnpm typecheck`
Expected: PASS. Leave uncommitted.

---

### Task 10: Rating change on the results screen

**Files:**

- Create: `src/lib/client/use-rating-change.ts`, `src/components/RatingChange.tsx`
- Modify: `src/components/Results.tsx`
- Test: `src/lib/client/use-rating-change.test.tsx`, `src/components/RatingChange.test.tsx`

**Interfaces:**

- Consumes: `api.history()` (now carries `ratingBefore`/`ratingAfter`), `useMe`.
- Produces: `useRatingChange(code: string, enabled: boolean, delays?: readonly number[]): { before: number; after: number } | null`; `<RatingChange code={string} versus={boolean} />`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/client/use-rating-change.test.tsx`:

```tsx
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/lib/protocol";

import { api } from "./api";
import { useRatingChange } from "./use-rating-change";

const entry = (ratingBefore: number | null, ratingAfter: number | null): HistoryEntry => ({
  code: "ABC234",
  theme: "001",
  pairs: 8,
  finishedAt: "2026-10-06T12:00:00.000Z",
  you: { pairs: 5, moves: 10, bestStreak: 2, rank: 1, ratingBefore, ratingAfter },
  players: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRatingChange", () => {
  it("finds the change on a later attempt, once the server has rated the game", async () => {
    const history = vi
      .spyOn(api, "history")
      .mockResolvedValueOnce([entry(null, null)])
      .mockResolvedValue([entry(1000, 1024)]);
    const { result } = renderHook(() => useRatingChange("ABC234", true, [100, 200, 300]));
    expect(result.current).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(result.current).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(result.current).toEqual({ before: 1000, after: 1024 });
    expect(history).toHaveBeenCalledTimes(2);
  });

  it("gives up quietly after the last attempt", async () => {
    const history = vi.spyOn(api, "history").mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useRatingChange("ABC234", true, [100, 100]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(history).toHaveBeenCalledTimes(2);
    expect(result.current).toBeNull();
  });

  it("does nothing when disabled", async () => {
    const history = vi.spyOn(api, "history");
    renderHook(() => useRatingChange("ABC234", false, [100]));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(history).not.toHaveBeenCalled();
  });

  it("stops polling when unmounted", async () => {
    const history = vi.spyOn(api, "history").mockResolvedValue([entry(null, null)]);
    const { unmount } = renderHook(() => useRatingChange("ABC234", true, [100, 100, 100]));
    await vi.advanceTimersByTimeAsync(100);
    unmount();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(history).toHaveBeenCalledTimes(1);
  });
});
```

Create `src/components/RatingChange.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as hook from "@/lib/client/use-rating-change";
import * as meModule from "@/lib/client/use-me";

import { RatingChange } from "./RatingChange";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const signedIn = { authEnabled: true, user: { id: "a", name: "A", email: null, image: null } };

describe("RatingChange", () => {
  it("shows the change with its sign", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByRole("status")).toHaveTextContent("Rating 1000 → 1024 (+24)");
  });

  it("shows a loss with a minus sign", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 976 });
    render(<RatingChange code="ABC234" versus />);
    expect(screen.getByRole("status")).toHaveTextContent("(−24)");
  });

  it("renders nothing, and does not look, for a guest or a solo game", () => {
    const spy = vi.spyOn(hook, "useRatingChange").mockReturnValue(null);
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
    const { container } = render(<RatingChange code="ABC234" versus />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).toHaveBeenCalledWith("ABC234", false);

    cleanup();
    vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
    render(<RatingChange code="ABC234" versus={false} />);
    expect(spy).toHaveBeenLastCalledWith("ABC234", false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/lib/client/use-rating-change.test.tsx src/components/RatingChange.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Hook**

Create `src/lib/client/use-rating-change.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

import { api } from "./api";

export type RatingChange = { before: number; after: number };

/** The server rates just after the finishing request, so look a few times with growing gaps. */
const DEFAULT_DELAYS_MS = [1_500, 3_000, 6_000] as const;

/**
 * This game's rating change, read from the player's history. Silent by design: if it never shows
 * up (guest, unrated game, network trouble) the results screen simply has no rating line.
 */
export function useRatingChange(
  code: string,
  enabled: boolean,
  delays: readonly number[] = DEFAULT_DELAYS_MS,
): RatingChange | null {
  const [change, setChange] = useState<RatingChange | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = async (n: number) => {
      try {
        const you = (await api.history()).find((h) => h.code === code)?.you;
        if (you && you.ratingBefore !== null && you.ratingAfter !== null) {
          if (!cancelled) setChange({ before: you.ratingBefore, after: you.ratingAfter });
          return;
        }
      } catch {
        // try again below
      }
      if (!cancelled && n + 1 < delays.length) schedule(n + 1);
    };
    const schedule = (n: number) => {
      timer = setTimeout(() => void attempt(n), delays[n]);
    };

    if (delays.length > 0) schedule(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, enabled, delays]);

  return change;
}
```

- [ ] **Step 4: Component and Results**

Create `src/components/RatingChange.tsx`:

```tsx
"use client";

import { useMe } from "@/lib/client/use-me";
import { useRatingChange } from "@/lib/client/use-rating-change";

/** "Rating 1000 → 1024 (+24)" once the server has rated the game. Nothing for guests and solo games. */
export function RatingChange({ code, versus }: { code: string; versus: boolean }) {
  const me = useMe();
  const change = useRatingChange(code, versus && Boolean(me?.user));
  if (!change) return null;
  const delta = change.after - change.before;
  return (
    <p className="rating-change" role="status">
      Rating {change.before} → {change.after} ({delta >= 0 ? "+" : "−"}
      {Math.abs(delta)})
    </p>
  );
}
```

In `src/components/Results.tsx` add `import { RatingChange } from "./RatingChange";` and render `<RatingChange code={view.code} versus={view.players.length >= 2} />` immediately before the final `<Link className="button" href="/">`.

- [ ] **Step 5: Run the suite**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS. If a `TableScreen`/`Results` test reaches the finished state and now trips on `useMe` fetching, spy `useMe` in that test (as `Profile.test.tsx` does). Leave uncommitted.

---

### Task 11: Docs, review and wrap

**Files:**

- Modify (via the `sync-docs` skill): `CLAUDE.md`, `README.md`

- [ ] **Step 1: Full CI run**

Run the `verify` skill (`pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`). Fix failures (run `pnpm format` if only formatting fails).

- [ ] **Step 2: Anti-cheat review**

The diff touches `src/lib/protocol/`, `src/server/db/history.ts` and the table action path. Run the `anti-cheat-reviewer` agent. Expected: no board state in new responses, no `table_state` reads in ratings code, leaderboards expose no `user_id`.

- [ ] **Step 3: Docs**

Run the `sync-docs` skill. Facts that changed and belong in `CLAUDE.md` / `README.md`: the `RatingsService` (`src/server/ratings/`) and `src/server/db/ratings.ts` in the Map; the invariant "history, public directory **and ratings/leaderboards** read `games`/`game_players`/`player_ratings`, never `table_state`"; new routes `/api/leaderboard`, `/api/me/stats`; the cron now also sweeps unrated games; ratings are applied after the finishing response via `after()`.

- [ ] **Step 4: Report**

State what is ready for the user to commit. Do **not** run E2E unless the user asks. Do not run `pnpm db:migrate`; remind the user the new migration `*_ratings.sql` must be applied by them before promoting the deployment.

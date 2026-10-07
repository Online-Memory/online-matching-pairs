# Progression 3b: Achievements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven persistent achievements, awarded server-side right after a game's XP, shown as chips on the results screen and as a locked/unlocked grid on the profile.

**Architecture:** A shared catalog and a pure `evaluateAchievements(lifetime)` in `src/lib/progress/`. A second additive migration adds `player_achievements`. After `ProgressService.awardGame` claims a game, it evaluates each signed-in participant's lifetime stats from `game_players` and inserts the earned ids with `ON CONFLICT DO NOTHING` (idempotent; a missed award repairs itself on the player's next game). The client reads them from `GET /api/me/progress` and the history entry.

**Tech Stack:** Same as plan 3a (Next.js routes, Postgres via `Db`, zod, React, Vitest with PGlite integration tests).

**Spec:** `docs/superpowers/specs/2026-10-07-progression-design.md`. **Depends on plan 3a being implemented first** (`ProgressService`, `src/server/db/progress.ts`, `ProgressResponse`, `useXpGain`, `XpGain`, `Profile` progress state).

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`; `src/lib/progress/` is shared and must NOT import it.
- Single-statement writes, no interactive transactions. Reads only `games`, `game_players`, `player_progress`, `player_achievements`; never `table_state`.
- Additive, backward-compatible migration via the `new-migration` skill rules (timestamp from `node -e 'console.log(Date.now())'`, strictly greater than the 3a migration's, both sections, no edits to existing files). **Never run `pnpm db:migrate` or `pnpm db:migrate:local`.** Never edit `.env*`.
- **No git operations.** Leave everything uncommitted; there are no commit steps.
- The client treats absent optional fields as "nothing to show" (older server during a deploy).
- All animation behind `prefers-reduced-motion: no-preference`.
- Achievement catalog and rules verbatim from the spec:

| Id           | Earned when                                                                |
| ------------ | -------------------------------------------------------------------------- |
| `first_game` | 1 finished game                                                            |
| `first_win`  | 1 win (rank 1 in a game with 2 or more seated players)                     |
| `win_10`     | 10 wins                                                                    |
| `games_50`   | 50 finished games                                                          |
| `streak_5`   | a game with best streak >= 5                                               |
| `streak_8`   | a game with best streak >= 8                                               |
| `flawless`   | a versus game (2 or more seated) with at least 3 pairs and `moves = pairs` |

- Run `verify` (lint, format:check, typecheck, test) before declaring done; no Playwright. Run the `anti-cheat-reviewer` agent on the final diff.
- The working tree holds unrelated uncommitted work (earlier phases, a `cheats` feature). Do not revert or reformat it. `src/app/globals.css` is shared: append at the end.

## Review Focus

- Awarding is idempotent: running `awardGame` and a later game's awarding again never duplicates a row or changes `earned_at`/`game_id` of an earned achievement.
- A missed award (the grant step failed after the game was claimed) repairs itself the next time the player finishes any game.
- Guests earn nothing; a solo game never earns `first_win` or `flawless` (they need 2 or more seated players), but does earn `first_game` and the streak ones.
- A game finished before the migration is not retroactively counted as "earned in that game": `first_game` is granted at the player's next awarded game (documented behaviour, not a bug).
- An older server that omits `achievements` must make the results screen and the profile show nothing broken (no `undefined` chips, no empty-state crash).

---

### Task 1: Catalog and evaluator

**Files:**

- Create: `src/lib/progress/achievements.ts`
- Test: `src/lib/progress/achievements.test.ts`

**Interfaces:**

- Produces:
  - `type AchievementId = "first_game" | "first_win" | "win_10" | "games_50" | "streak_5" | "streak_8" | "flawless"`
  - `ACHIEVEMENTS: readonly { id: AchievementId; title: string; description: string }[]` (catalog order is display order)
  - `achievementById(id: string): { id: AchievementId; title: string; description: string } | undefined`
  - `type Lifetime = { games: number; wins: number; bestStreak: number; flawless: number }`
  - `evaluateAchievements(lifetime: Lifetime): AchievementId[]` (catalog order)

- [ ] **Step 1: Write the failing test**

`src/lib/progress/achievements.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ACHIEVEMENTS, achievementById, evaluateAchievements, type Lifetime } from "./achievements";

const base: Lifetime = { games: 0, wins: 0, bestStreak: 0, flawless: 0 };

describe("evaluateAchievements", () => {
  it("earns nothing with no games", () => {
    expect(evaluateAchievements(base)).toEqual([]);
  });

  it.each([
    [{ games: 1 }, ["first_game"]],
    [{ games: 1, wins: 1 }, ["first_game", "first_win"]],
    [{ games: 12, wins: 10 }, ["first_game", "first_win", "win_10"]],
    [{ games: 50 }, ["first_game", "games_50"]],
    [{ games: 3, bestStreak: 5 }, ["first_game", "streak_5"]],
    [{ games: 3, bestStreak: 8 }, ["first_game", "streak_5", "streak_8"]],
    [{ games: 3, flawless: 1 }, ["first_game", "flawless"]],
  ] as [Partial<Lifetime>, string[]][])("%j earns %j", (over, expected) => {
    expect(evaluateAchievements({ ...base, ...over })).toEqual(expected);
  });

  it("uses the exact thresholds", () => {
    const ids = (over: Partial<Lifetime>) => evaluateAchievements({ ...base, games: 60, ...over });
    expect(ids({ wins: 9 })).not.toContain("win_10");
    expect(ids({ wins: 10 })).toContain("win_10");
    expect(ids({ bestStreak: 4 })).not.toContain("streak_5");
    expect(ids({ bestStreak: 7 })).not.toContain("streak_8");
    expect(evaluateAchievements({ ...base, games: 49 })).not.toContain("games_50");
  });
});

describe("catalog", () => {
  it("has seven uniquely identified, described achievements", () => {
    expect(ACHIEVEMENTS).toHaveLength(7);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(7);
    for (const a of ACHIEVEMENTS) {
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(0);
    }
  });

  it("looks achievements up by id and ignores unknown ids", () => {
    expect(achievementById("flawless")?.title).toBe("Flawless");
    expect(achievementById("from_the_future")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/progress/achievements.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/progress/achievements.ts`:

```ts
export type AchievementId =
  "first_game" | "first_win" | "win_10" | "games_50" | "streak_5" | "streak_8" | "flawless";

export type Achievement = { id: AchievementId; title: string; description: string };

/** Display order. Only ids are stored; titles live here so they can change without a migration. */
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_game", title: "First game", description: "Finish a game." },
  { id: "first_win", title: "First win", description: "Win a game against other players." },
  { id: "win_10", title: "Ten wins", description: "Win 10 games against other players." },
  { id: "games_50", title: "Veteran", description: "Finish 50 games." },
  { id: "streak_5", title: "Hot streak", description: "Match 5 pairs in a row." },
  { id: "streak_8", title: "Unstoppable", description: "Match 8 pairs in a row." },
  {
    id: "flawless",
    title: "Flawless",
    description: "Play at least 3 pairs without a single miss, against others.",
  },
];

export const achievementById = (id: string): Achievement | undefined => ACHIEVEMENTS.find((a) => a.id === id);

/** What the rules need to know about a player's finished games (see `queryLifetime` on the server). */
export type Lifetime = {
  games: number;
  /** Games won with 2 or more seated players. */
  wins: number;
  /** Best streak across all games. */
  bestStreak: number;
  /** Versus games with at least 3 pairs and no misses. */
  flawless: number;
};

const RULES: Record<AchievementId, (l: Lifetime) => boolean> = {
  first_game: (l) => l.games >= 1,
  first_win: (l) => l.wins >= 1,
  win_10: (l) => l.wins >= 10,
  games_50: (l) => l.games >= 50,
  streak_5: (l) => l.bestStreak >= 5,
  streak_8: (l) => l.bestStreak >= 8,
  flawless: (l) => l.flawless >= 1,
};

/** Everything this player has earned so far, in catalog order. Pure: a function of persisted stats only. */
export function evaluateAchievements(lifetime: Lifetime): AchievementId[] {
  return ACHIEVEMENTS.filter((a) => RULES[a.id](lifetime)).map((a) => a.id);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/progress/achievements.test.ts`
Expected: PASS.

---

### Task 2: Migration

**Files:**

- Create: `db/migrations/<epoch>_achievements.sql` (epoch strictly greater than the 3a `_progress.sql` file's)
- Modify: `tests/integration/db.ts` (both `TRUNCATE` lists)
- Test: `tests/integration/achievements-migration.test.ts`

**Interfaces:**

- Produces schema: `player_achievements(user_id text, achievement_id text, earned_at timestamptz default now(), game_id uuid null, primary key (user_id, achievement_id))`.

- [ ] **Step 1: Write the failing test**

`tests/integration/achievements-migration.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("achievements migration", () => {
  it("applies after the progress migration and keeps one row per player and achievement", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const progress = files.findIndex((f) => f.endsWith("_progress.sql"));
    const achievements = files.findIndex((f) => f.endsWith("_achievements.sql"));
    expect(progress).toBeGreaterThan(0);
    expect(achievements).toBeGreaterThan(progress);
    for (const file of files) {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    }

    await db.exec(`INSERT INTO player_achievements (user_id, achievement_id) VALUES ('u1', 'first_game')`);
    await expect(
      db.exec(`INSERT INTO player_achievements (user_id, achievement_id) VALUES ('u1', 'first_game')`),
    ).rejects.toThrow();
    const rows = (
      await db.query<{ game_id: string | null; earned_at: Date }>(
        `SELECT game_id, earned_at FROM player_achievements`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.game_id).toBeNull();
    expect(rows[0]!.earned_at).toBeInstanceOf(Date);
    await db.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/achievements-migration.test.ts`
Expected: FAIL (`achievements` index is -1).

- [ ] **Step 3: Create the migration**

`db/migrations/<epoch>_achievements.sql`:

```sql
-- Up Migration

-- Earned achievements. Purely additive: the old deployment never reads or writes this. Only ids are stored;
-- titles and rules live in code. `game_id` is the game that granted it, with no foreign key on purpose:
-- old games may be pruned, but an earned achievement must outlive them.
CREATE TABLE player_achievements (
  user_id text NOT NULL,
  achievement_id text NOT NULL,
  earned_at timestamptz NOT NULL DEFAULT now(),
  game_id uuid,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE INDEX player_achievements_game_idx ON player_achievements (game_id) WHERE game_id IS NOT NULL;

-- Down Migration

DROP INDEX player_achievements_game_idx;
DROP TABLE player_achievements;
```

In `tests/integration/db.ts`, both `TRUNCATE` strings (pg and PGlite) become:

```
TRUNCATE games, profiles, friendships, table_invites, player_ratings, player_progress, player_achievements CASCADE
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/integration/achievements-migration.test.ts tests/integration/progress-migration.test.ts`
Expected: PASS. Do NOT run `pnpm db:migrate*`.

---

### Task 3: Server awarding and reads

**Files:**

- Modify: `src/lib/protocol/index.ts`, `src/server/db/progress.ts`, `src/server/progress/service.ts`, `src/server/db/history.ts`
- Test: `tests/integration/achievements-service.test.ts` (new); update `tests/integration/progress-service.test.ts` only if its assertions on `progressFor` or history shape need the new fields

**Interfaces:**

- Consumes: `evaluateAchievements`, `Lifetime` (Task 1); migration (Task 2); `ProgressService` and `src/server/db/progress.ts` (plan 3a).
- Produces:
  - protocol: `HistoryEntry.you.achievements?: string[]` (achievements earned in that game); `ProgressResponse.achievements?: { id: string; earnedAt: string }[]`
  - `queryLifetime(db, userId): Promise<Lifetime>`, `grantAchievements(db, userId, ids, gameId, at): Promise<void>`, `listAchievements(db, userId): Promise<{ id: string; earnedAt: string }[]>` in `src/server/db/progress.ts`
  - `ProgressService.awardGame` grants achievements after it claims a game; `progressFor` includes `achievements`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/achievements-service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/integration/achievements-service.test.ts`
Expected: FAIL (no achievements granted; `achievements` undefined).

- [ ] **Step 3: Protocol types**

In `src/lib/protocol/index.ts`: in `HistoryEntry.you`, after `xpAfter`:

```ts
    /** Ids of the achievements this game earned. Absent from an older server. */
    achievements?: string[];
```

and in `ProgressResponse`, after `xpForNext`:

```ts
  /** Everything earned so far. Absent from an older server. */
  achievements?: { id: string; earnedAt: string }[];
```

- [ ] **Step 4: DB layer**

In `src/server/db/progress.ts`, add `import type { Lifetime } from "@/lib/progress/achievements";` (above `import type { Db }`) and append:

```ts
const lifetimeRowSchema = z.object({
  games: z.number().int(),
  wins: z.number().int(),
  best_streak: z.number().int(),
  flawless: z.number().int(),
});

/** Lifetime numbers the achievement rules need, from finished games. A solo game is never a win or flawless. */
export async function queryLifetime(db: Db, userId: string): Promise<Lifetime> {
  const rows = await db.query(
    `WITH mine AS (
       SELECT gp.rank, gp.best_streak, gp.pairs, gp.moves,
              (SELECT count(*) FROM game_players o WHERE o.game_id = gp.game_id) AS seated
         FROM game_players gp JOIN games g ON g.id = gp.game_id
        WHERE gp.user_id = $1 AND g.status = 'finished'
     )
     SELECT count(*)::int AS games,
            (count(*) FILTER (WHERE seated >= 2 AND rank = 1))::int AS wins,
            coalesce(max(best_streak), 0)::int AS best_streak,
            (count(*) FILTER (WHERE seated >= 2 AND pairs >= 3 AND moves = pairs))::int AS flawless
       FROM mine`,
    [userId],
  );
  const r = lifetimeRowSchema.parse(rows[0]);
  return { games: r.games, wins: r.wins, bestStreak: r.best_streak, flawless: r.flawless };
}

/** Records achievements; one already earned keeps its original `earned_at` and game. */
export async function grantAchievements(db: Db, userId: string, ids: string[], gameId: string, at: string) {
  await db.query(
    `INSERT INTO player_achievements (user_id, achievement_id, earned_at, game_id)
     SELECT $1, a, $4::timestamptz, $3::uuid FROM jsonb_array_elements_text($2::jsonb) AS a
     ON CONFLICT (user_id, achievement_id) DO NOTHING`,
    [userId, JSON.stringify(ids), gameId, at],
  );
}

/** What a player has earned, oldest first. */
export async function listAchievements(db: Db, userId: string) {
  const rows = await db.query<{ achievement_id: string; earned_at: Date | string }>(
    `SELECT achievement_id, earned_at FROM player_achievements
      WHERE user_id = $1 ORDER BY earned_at, achievement_id`,
    [userId],
  );
  return rows.map((r) => ({ id: r.achievement_id, earnedAt: new Date(r.earned_at).toISOString() }));
}
```

- [ ] **Step 5: Service**

In `src/server/progress/service.ts`: add `import { evaluateAchievements } from "@/lib/progress/achievements";` (alphabetical: before `levels`), extend the `@/server/db/progress` import with `grantAchievements, listAchievements, queryLifetime`, and make three changes.

Replace `if (applied) return true;` in `awardGame` with:

```ts
if (applied) {
  await this.grantAchievements(gameId, userIds, at);
  return true;
}
```

Add a method below `awardGame`:

```ts
  /**
   * Evaluated from lifetime stats and inserted with ON CONFLICT DO NOTHING, so it is idempotent. Best
   * effort: the XP is already committed, and anything missed here is granted at the player's next game.
   */
  private async grantAchievements(gameId: string, userIds: string[], at: string) {
    for (const userId of userIds) {
      try {
        const earned = evaluateAchievements(await queryLifetime(this.db, userId));
        if (earned.length > 0) await grantAchievements(this.db, userId, earned, gameId, at);
      } catch (error) {
        console.error("achievement grant failed", error);
      }
    }
  }
```

Replace `progressFor` with:

```ts
  async progressFor(userId: string): Promise<ProgressResponse> {
    const [xp, achievements] = await Promise.all([queryXp(this.db, userId), listAchievements(this.db, userId)]);
    return { xp, ...levelForXp(xp), achievements };
  }
```

- [ ] **Step 6: History**

In `src/server/db/history.ts`: add to the `historyRowSchema` player object nothing; instead add a top-level field after `finished_at`:

```ts
  achievements: z.array(z.string()),
```

add to the SELECT list, after `g.finished_at,`:

```sql
            (SELECT coalesce(jsonb_agg(a.achievement_id ORDER BY a.achievement_id), '[]'::jsonb)
               FROM player_achievements a WHERE a.game_id = g.id AND a.user_id = me.user_id) AS achievements,
```

and add to the `you` object, after `xpAfter: me.xp_after,`:

```ts
        achievements: row.achievements,
```

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm vitest run tests/integration && pnpm typecheck`
Expected: PASS, typecheck clean. If an older history test asserts an exact `you` object, add `achievements: []` (and the 3a XP fields) there rather than loosening it.

---

### Task 4: Client: results chips and profile grid

**Files:**

- Create: `src/components/AchievementsPanel.tsx`
- Modify: `src/lib/client/use-xp-gain.ts`, `src/components/XpGain.tsx`, `src/components/Profile.tsx`, `src/app/globals.css` (append)
- Test: `src/components/AchievementsPanel.test.tsx` (new); update `src/lib/client/use-xp-gain.test.tsx`, `src/components/XpGain.test.tsx`, `src/components/Profile.test.tsx`

**Interfaces:**

- Consumes: `ACHIEVEMENTS`, `achievementById` (Task 1); `ProgressResponse.achievements`, `HistoryEntry.you.achievements` (Task 3); `useXpGain`, `XpGain`, `Profile` (plan 3a).
- Produces:
  - `useXpGain` now returns `{ gained: number; after: number; achievements: string[] } | null` (`[]` when the server omits the field)
  - `AchievementsPanel({ earned }: { earned: readonly { id: string; earnedAt: string }[] })`: the whole catalog, unlocked ones marked with their date, the rest locked; unknown ids ignored.

- [ ] **Step 1: Write the failing tests**

`src/components/AchievementsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ACHIEVEMENTS } from "@/lib/progress/achievements";

import { AchievementsPanel } from "./AchievementsPanel";

afterEach(cleanup);

describe("AchievementsPanel", () => {
  it("lists every achievement, unlocked ones first-class and the rest locked", () => {
    render(<AchievementsPanel earned={[{ id: "first_game", earnedAt: "2026-10-07T12:00:00.000Z" }]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ACHIEVEMENTS.length);
    const first = screen.getByText("First game").closest("li")!;
    expect(first).toHaveAttribute("data-earned", "true");
    expect(within(first).getByText(/Earned/)).toBeInTheDocument();
    expect(screen.getByText("Flawless").closest("li")).toHaveAttribute("data-earned", "false");
  });

  it("shows everything locked when nothing is earned, and ignores ids it does not know", () => {
    render(<AchievementsPanel earned={[{ id: "from_the_future", earnedAt: "2026-10-07T12:00:00.000Z" }]} />);
    expect(screen.getAllByRole("listitem").every((li) => li.getAttribute("data-earned") === "false")).toBe(
      true,
    );
    expect(screen.getByText("0 of 7 earned")).toBeInTheDocument();
  });
});
```

In `src/lib/client/use-xp-gain.test.tsx`: extend the entry helper's parameter type and the first test:

```tsx
const entry = (
  xp: { xpGained?: number | null; xpAfter?: number | null; achievements?: string[] } = {},
): HistoryEntry => ({
```

and in the first test change the second mock and expectation to:

```tsx
      .mockResolvedValue([entry({ xpGained: 125, xpAfter: 325, achievements: ["first_win"] })]);
...
    expect(result.current).toEqual({ gained: 125, after: 325, achievements: ["first_win"] });
```

and add a test:

```tsx
it("treats an older server's missing achievements as none", async () => {
  vi.spyOn(api, "history").mockResolvedValue([entry({ xpGained: 10, xpAfter: 10 })]);
  const { result } = renderHook(() => useXpGain("ABC234", true, [100]));
  await advance(100);
  expect(result.current).toEqual({ gained: 10, after: 10, achievements: [] });
});
```

In `src/components/XpGain.test.tsx`: add `achievements: []` to the existing `mockReturnValue({...})` objects, and add:

```tsx
it("lists the achievements this game earned, by title, skipping unknown ids", () => {
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(hook, "useXpGain").mockReturnValue({
    gained: 50,
    after: 150,
    achievements: ["first_win", "from_the_future"],
  });
  render(<XpGain code="ABC234" />);
  expect(screen.getByText("First win")).toBeInTheDocument();
  expect(screen.queryByText("from_the_future")).toBeNull();
});
```

In `src/components/Profile.test.tsx`: change the `api.progress` mock in `beforeEach` to include `achievements: [{ id: "first_game", earnedAt: "2026-10-07T12:00:00.000Z" }]` and add inside `describe("Profile", …)`:

```tsx
it("shows the achievements panel for a signed-in user", async () => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: "a@example.com", image: null },
  });
  render(<Profile />);
  expect(await screen.findByRole("heading", { name: "Achievements" })).toBeInTheDocument();
  expect(screen.getByText("1 of 7 earned")).toBeInTheDocument();
});

it("copes with an older server that sends no achievements", async () => {
  vi.spyOn(api, "progress").mockResolvedValue({ xp: 0, level: 1, xpIntoLevel: 0, xpForNext: 100 });
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: "a@example.com", image: null },
  });
  render(<Profile />);
  expect(await screen.findByText("0 of 7 earned")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/AchievementsPanel.test.tsx src/lib/client/use-xp-gain.test.tsx src/components/XpGain.test.tsx src/components/Profile.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/client/use-xp-gain.ts`: change the exported type and the `setGain` call:

```ts
export type XpGain = { gained: number; after: number; achievements: string[] };
```

```ts
if (!cancelled) setGain({ gained: you.xpGained, after: you.xpAfter, achievements: you.achievements ?? [] });
```

`src/components/AchievementsPanel.tsx`:

```tsx
import { ACHIEVEMENTS } from "@/lib/progress/achievements";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/** The whole catalog, so players can see what is left to earn. Unknown ids from a newer server are ignored. */
export function AchievementsPanel({ earned }: { earned: readonly { id: string; earnedAt: string }[] }) {
  const byId = new Map(earned.map((e) => [e.id, e.earnedAt] as const));
  const count = ACHIEVEMENTS.filter((a) => byId.has(a.id)).length;
  return (
    <section className="achievements" aria-labelledby="achievements-heading">
      <h2 id="achievements-heading">Achievements</h2>
      <p className="hint">
        {count} of {ACHIEVEMENTS.length} earned
      </p>
      <ul className="achievement-list">
        {ACHIEVEMENTS.map((a) => {
          const at = byId.get(a.id);
          return (
            <li key={a.id} className="achievement" data-earned={at !== undefined}>
              <span className="achievement-title">{a.title}</span>
              <span className="achievement-desc">{a.description}</span>
              <span className="hint">{at ? `Earned ${day(at)}` : "Locked"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

`src/components/XpGain.tsx`: add `import { achievementById } from "@/lib/progress/achievements";` (alphabetical: before `levels`) and, in `XpLine`, after the `levelUp` banner block, before the `ConfettiBurst` line:

```tsx
{
  gain.achievements.length > 0 && (
    <ul className="achievement-chips" aria-label="Achievements earned">
      {gain.achievements.flatMap((id) => {
        const a = achievementById(id);
        return a ? [<li key={id}>{a.title}</li>] : [];
      })}
    </ul>
  );
}
```

`src/components/Profile.tsx`: add `import { AchievementsPanel } from "./AchievementsPanel";` (before `Button`) and render, directly below the `<LevelBar … />` line:

```tsx
{
  progress && <AchievementsPanel earned={progress.achievements ?? []} />;
}
```

Append to the end of `src/app/globals.css`:

```css
/* ------------------------------------------------------------- achievements */

.achievement-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  margin: 0 0 0.75rem;
  padding: 0;
  list-style: none;
}
.achievement-chips li {
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8125rem;
  font-weight: 800;
  color: #1b1200;
  background: #ffc93c;
}

.achievement-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.achievement {
  display: grid;
  gap: 0.125rem;
  padding: 0.625rem 0.75rem;
  border-radius: var(--radius-control);
  border: 2px solid var(--line);
  background: var(--card);
}
.achievement[data-earned="true"] {
  border-color: #ffc93c;
}
.achievement[data-earned="false"] {
  opacity: 0.6;
}
.achievement-title {
  font-weight: 800;
}
.achievement-desc {
  font-size: 0.875rem;
  color: var(--ink-soft);
}

@media (prefers-reduced-motion: no-preference) {
  .achievement-chips li {
    animation: award-pop 400ms ease-out 1000ms both;
  }
}
```

(`award-pop` is the keyframe from the Phase 2 podium styles; if it is absent in the working tree, define an equivalent `@keyframes achievement-pop` with the same body.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/components src/lib/client`
Expected: PASS.

---

### Task 5: Verify, review, report

- [ ] **Step 1:** Run the `verify` skill (lint → format:check → typecheck → test). No E2E, no `pnpm db:migrate*`.
- [ ] **Step 2:** Run the `anti-cheat-reviewer` agent on the diff (note the unrelated `cheats` work is out of scope). Expected: no hidden-face exposure; new reads touch only `games`, `game_players`, `player_progress`, `player_achievements`.
- [ ] **Step 3:** Report what is ready to commit (nothing is committed), both migration file names, and that neither migration has been applied anywhere. The user decides when to run them. A browser check of the profile and results screens is still pending.

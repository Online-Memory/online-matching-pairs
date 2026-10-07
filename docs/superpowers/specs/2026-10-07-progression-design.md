# Gamification Phase 3: Progression (XP, levels, achievements)

Part of a three-phase gamification effort (1: in-game juice, done; 2: post-game payoff, done; 3: progression).
Delivered in two parts, each with its own implementation plan:

- **3a:** XP, levels, migration, server awarding, results display, level bar.
- **3b:** achievements, their awarding, and their UI.

## Goal

Give signed-in players persistent progression: XP earned from every finished game, levels derived from XP,
and unlockable achievements, all awarded server-side and shown after a game and on the profile.

## Success criteria

- A signed-in player earns XP from every finished game they played, exactly once per game, even if the
  awarding runs twice or concurrently.
- XP comes from three sources: matches found, streak, and final position.
- The results screen shows the XP gained, a level-up moment when a level is crossed, and (3b) newly earned
  achievements. The profile shows level, XP progress and (3b) all achievements.
- Guests earn nothing and see nothing new. Nothing breaks during a rolling deploy when an old server omits
  the new fields.
- The client can never claim XP or achievements: everything is computed server-side from persisted data.

## XP formula (pure, shared)

`computeXp({ pairs, bestStreak, rank, players })` in `src/lib/progress/xp.ts` (no `server-only`: the client
also imports from `src/lib/progress/` to display levels).

| Source                                       | XP                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Match found                                  | 10 per pair                                                                     |
| Streak                                       | 5 per step of the best streak above 1, capped at 10 steps (best run of 4 = +15) |
| Final position (versus only, `players >= 2`) | 1st +50, 2nd +30, 3rd +20, any other rank +10                                   |

Ties take the better position (equal ranks share it). A solo game earns pairs and streak XP only. Example:
an 8-pair win with a best streak of 4 earns 80 + 15 + 50 = 145. Only the best streak is used because that is
what `game_players` stores.

## Levels (pure, shared)

Total XP to reach level `L` (L >= 1) is `50 * L * (L - 1)`: level 2 at 100, level 3 at 300, level 5 at 1000,
level 10 at 4500. `levelForXp(xp)` in `src/lib/progress/levels.ts` returns
`{ level, xpIntoLevel, xpForNext }`. Level is never stored; it is derived from XP.

## Achievements (3b)

A catalog in code (`src/lib/progress/achievements.ts`: id, title, description). Only
`(user_id, achievement_id, earned_at, game_id)` is stored. Version 1:

| Id           | Earned when                                                  |
| ------------ | ------------------------------------------------------------ |
| `first_game` | the player has finished 1 game                               |
| `first_win`  | the player has 1 win (rank 1 in a game of 2 or more players) |
| `win_10`     | 10 such wins                                                 |
| `games_50`   | 50 finished games                                            |
| `streak_5`   | a game with best streak >= 5                                 |
| `streak_8`   | a game with best streak >= 8                                 |
| `flawless`   | a versus game with at least 3 pairs and `moves = pairs`      |

Each is derivable from lifetime `game_players` data, so evaluation is a pure function of persisted rows and a
missed award repairs itself on the player's next game.

## Server design (reuses the ratings pattern)

**Migration (additive, backward compatible; use the `new-migration` skill):**

- `player_progress(user_id text primary key, xp int not null default 0 check (xp >= 0), version int not
null default 0, updated_at timestamptz not null default now())`
- `games.progress_applied_at timestamptz` (NULL = not yet awarded; separate from `rated_at` because solo and
  guest-seat games are not rated but still award XP)
- `game_players.xp_gained int` and `game_players.xp_after int` (NULL until awarded)
- index for the sweeper: `games (finished_at) WHERE status = 'finished' AND progress_applied_at IS NULL`
- backfill: mark games already finished as applied (no retroactive XP), as the ratings migration did
- 3b adds `player_achievements(user_id text, achievement_id text, earned_at timestamptz not null default
now(), game_id text, primary key (user_id, achievement_id))`

**Idempotency.** One SQL statement (data-modifying CTEs, no interactive transaction) claims
`games.progress_applied_at` and updates every participant's `player_progress` row, version-checked and
retried on conflict, exactly as `applyRatings` does. Achievements (3b) are inserted afterwards with
`ON CONFLICT DO NOTHING`, so a repeat or a crash in between is harmless.

**Wiring.** `ProgressService` in `src/server/progress/` (starts with `import "server-only"`), queries in
`src/server/db/progress.ts`. It runs after the finishing response, right after rating, and the daily cron
sweeps unawarded games. Only signed-in participants (rows with a `user_id`) earn XP; guest seats are
skipped. Progress queries read `games`, `game_players` and `player_progress`, never `table_state`.

## API and client

- `GET /api/me/progress` returns `{ xp, level, xpIntoLevel, xpForNext }` (3b adds `achievements: [{ id,
earnedAt }]`).
- `HistoryEntry.you` gains optional `xpGained`, `xpAfter` (3a) and `achievements: string[]` (3b, the ones
  earned in that game). The client treats a missing field as "nothing to show": an older server during a
  deploy omits them.
- 3a UI: `LevelBar` on the profile; `XpGain` on `Results` ("+145 XP", count-up via `useCountUp`, and a
  level-up moment with `ConfettiBurst` when `levelForXp(xpAfter - xpGained).level < levelForXp(xpAfter).level`),
  fed by the existing history polling (`useRatingChange` pattern: look a few times, stay silent on failure).
- 3b UI: `AchievementsPanel` on the profile (locked and unlocked states) and newly earned achievements on
  `Results`.
- All motion is gated behind `prefers-reduced-motion`.

## Testing

- Unit: `computeXp` (solo, ties, streak cap, every placement), `levelForXp` boundaries (99/100, 299/300).
- Integration (PGlite, existing harness): the claim is idempotent (apply twice, XP counted once); concurrent
  applies retry; guests are skipped; solo games award; a game with `progress_applied_at` set is not awarded
  again; the sweeper finds unawarded games.
- Component: `LevelBar`, `XpGain` (level-up shown only when a level is crossed; nothing when fields are
  missing), `AchievementsPanel` (3b).
- No E2E unless asked.

## Guardrails

Awarding is server-side from persisted `game_players` data. This touches `src/lib/protocol` and a new DB
module, so the `anti-cheat-reviewer` runs on the diff. The migration is additive and goes through the
`new-migration` skill; never run `pnpm db:migrate` or `pnpm db:migrate:local` unless the user asks.

## Out of scope

Daily challenges, XP caps or solo throttling, sound, retroactive XP for past games, tier-linked achievements.

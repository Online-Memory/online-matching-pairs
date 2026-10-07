# Gamification Phase 2: Post-game payoff

Part of a three-phase gamification effort (1: in-game juice, done; 2: post-game payoff; 3: progression and
achievements). This spec covers Phase 2 only. It is entirely client-side: no server change, no migration.

## Goal

Make the end of a game feel rewarding: an animated podium, award chips, a rating count-up, and rank tiers
(Bronze to Diamond) with a promotion celebration.

## Success criteria

- A finished game of 2 or more players shows an animated top-3 podium, with ties sharing a step.
- Qualifying players get award chips (Longest streak, Flawless, Dominant).
- A signed-in viewer's rating counts from the old to the new value; crossing a tier boundary upward shows a
  "Promoted to X" moment with a confetti burst.
- Tier badges appear on the results screen, the leaderboard rows and the stats panel.
- Under `prefers-reduced-motion` the final values show immediately, with no animation.
- Guests, solo games and unrated games behave as today (no awards, no rating line).

## Data available (no server change)

The finished `TableView` already carries `pairs`, `moves`, `bestStreak` and `rank` for every player.
`useRatingChange` already yields the viewer's `{ before, after }` rating. Nothing new leaves the server.

## Design

### 1. Tiers: `src/lib/client/tiers.ts` (pure)

`tierForRating(rating: number): { tier: Tier; next: Tier | null; progress: number }` where
`Tier = "bronze" | "silver" | "gold" | "platinum" | "diamond"` and `progress` is 0 to 1 within the tier
(1 for Diamond).

| Tier     | Rating         |
| -------- | -------------- |
| Bronze   | below 900      |
| Silver   | 900-1099       |
| Gold     | 1100-1299      |
| Platinum | 1300-1499      |
| Diamond  | 1500 and above |

New players start at 1000, so they begin in Silver. Also exports `TIER_ORDER` and `tierRank(tier)` so a
promotion is `tierRank(after) > tierRank(before)`.

### 2. Awards: `src/lib/client/awards.ts` (pure)

`computeAwards(players: PlayerView[], totalPairs: number): Record<string, Award[]>` keyed by player id,
`Award = "streak" | "flawless" | "dominant"`. Only for games with 2 or more players; otherwise `{}`.

- `streak` (Longest streak): the highest `bestStreak`, when it is at least 3. Ties share it.
- `flawless`: `moves === pairs` and `pairs >= 3` (no misses).
- `dominant`: `pairs * 2 > totalPairs`.

"Fastest memory" is out: the view has no timing data and adding it would need a server change.

### 3. Components

- `Podium`: top 3 by `rank` (ties share a step; a missing step is simply absent). Bars rise in sequence and
  pair counts count up. Sits above the existing results table, which stays.
- `Awards`: award chips rendered on the player rows of the results table.
- `TierBadge`: small badge (`tier` prop), reused by `Results`, `Leaderboard` and `StatsPanel`.
- `RatingChange` (existing): the number counts from `before` to `after` over about a second; if the tier
  rose, it shows "Promoted to X" with a `ConfettiBurst` at the badge. The rating hook is unchanged.

### 4. Motion and failure behaviour

- All animation is gated behind `prefers-reduced-motion: no-preference`; reduced motion shows final values at
  once and no confetti.
- If the rating never arrives (guest, unrated, network trouble) the rating part is simply absent, as today.
- The count-up uses `requestAnimationFrame` and cancels on unmount.

### 5. Testing

- Unit: tier boundaries (899/900, 1099/1100, 1299/1300, 1499/1500), progress, `tierRank`; awards for ties,
  solo, no qualifiers, and a player who both is flawless and dominant.
- Component: podium order with ties and with only two players; award chips; `RatingChange` shows the final
  value under reduced motion, the promotion banner when the tier rises, and none when it does not; tier
  badge on a leaderboard row.
- No pixel-level animation tests; E2E only on request.

## Out of scope

XP, levels, persistent achievements, daily challenges (Phase 3); sound; any server or schema change.

## Verification

`verify` skill (lint, format, typecheck, Vitest). The `anti-cheat-reviewer` is not required (no engine,
protocol, table-route or history change).

# Ratings, stats and leaderboards: design

Date: 2026-10-06. Status: draft for review.

## Goal

Competition. Signed-in players get a rating, lifetime stats and leaderboards (global and friends-only). Badges, XP and
daily streaks are out of scope for this phase.

## Decisions (agreed)

- Approach C: rate a game after it finishes, idempotently, outside the hot save path.
- Rated games: every finished game with 2 or more signed-in players. Guests are ignored and are not opponents.
- Leaderboard eligibility: every signed-in user with a `player_ratings` row, from their first rated game. There is no
  minimum game count. New players start at 1000 and the faster K (below) lets them settle quickly. Signed-in users
  who have not yet played a rated game have no row and do not appear.
- No backfill: ratings start fresh. Games finished before the migration are never rated. The migration marks them
  with `rated_at = finished_at` so the sweeper skips them.

## Defaults chosen by the author (change if you disagree)

- **Global leaderboard is public** (handle and display name only, never `user_id`). The friends scope needs sign-in.

## 1. Data model (one additive migration)

- `player_ratings(user_id text PK, rating int NOT NULL DEFAULT 1000, rated_games int NOT NULL DEFAULT 0,
wins int NOT NULL DEFAULT 0, version int NOT NULL DEFAULT 0, updated_at timestamptz)`.
- Index `(rating DESC, rated_games DESC, user_id)` for the leaderboard (no partial predicate, since there is no
  eligibility threshold).
- `games.rated_at timestamptz` (nullable): idempotency flag. The same migration runs
  `UPDATE games SET rated_at = finished_at WHERE status = 'finished'` so pre-existing games are never rated (no
  backfill). Games the old deployment finishes between migrating and promotion keep `rated_at IS NULL` and are
  picked up by the sweeper, which is intended.
- `game_players.rating_before int`, `rating_after int` (nullable).
- Created with the `new-migration` skill; backward compatible (old deployment ignores all of it).

Applying a rating is one statement (no interactive transactions):

1. Read the game's signed-in players and their `player_ratings` rows; create missing rows with
   `INSERT ... ON CONFLICT DO NOTHING`.
2. Compute new ratings in the pure function (section 2).
3. One data-modifying CTE: set `games.rated_at` `WHERE rated_at IS NULL`, update each `player_ratings` row
   `WHERE version = $expected` (bumping `version`), write `rating_before`/`rating_after` to `game_players`.
   If the matched player-row count is wrong, nothing is applied; re-read and retry.

Skipped: `abandoned` games, players with null `rank`, games with fewer than 2 signed-in players.

Everything except the rating is derived on read from `games` and `game_players` (games, wins, win rate, best streak,
accuracy = pairs / moves), including casual games.

## 2. Rating maths (`src/server/ratings/rating.ts`, pure)

Input: `{userId, rating, ratedGames, rank}[]` and `repeatCounts` (rated games each pair shared in the last 24 h).
Output: `{userId, newRating, delta, won}[]`.

Pairwise Elo. For each pair: `S_ij` is 1 / 0.5 / 0 for ranked above / tied / below;
`E_ij = 1 / (1 + 10^((R_j - R_i) / 400))`.
`delta_i = K / (n - 1) * sum_j w_ij * (S_ij - E_ij)`, rounded.

- `K = 32`, or 48 while `ratedGames < 10`. Start rating 1000, floor 100.
- `won` when `rank === 1` (a tie for first counts).
- Farming damping: `w_ij = max(0.25, 1 - 0.25 * k)`, `k` = rated games the pair already shared in the last 24 h.
  `repeatCounts` is queried from `games`/`game_players` before the pure call.
- Leaderboard order: rating desc, then `rated_games` desc, then `user_id`.
- All constants live at the top of the file.

## 3. Service, triggers, API, UI

`src/server/ratings/service.ts` (`import "server-only"`; never reads `table_state` or `friendships`):

- `rateGame(gameId)`: claim-and-apply with version-conflict retry.
- `sweepUnrated(limit)`: finished games with `rated_at IS NULL`, oldest first.
- `leaderboard({scope, userId?, limit})`: friends scope takes ids from `FriendsService`.
- `statsFor(userId)`.

Triggers:

1. After the finishing request responds (Next `after()`; read `node_modules/next/dist/docs/` for the exact API first),
   call `rateGame`. Failures are logged and swallowed. `TableService` is not changed.
2. `/api/cron/cleanup` also calls `sweepUnrated(200)` (backstop; the cron is daily).

Routes: `GET /api/leaderboard?scope=global|friends`, `GET /api/me/stats`; `GET /api/me/history` gains
`ratingBefore`/`ratingAfter` on `HistoryEntry.you`. Types in `src/lib/protocol/`, hooks in `src/lib/client/`.

UI: stats panel on `/profile`; `/leaderboard` page (Global / Friends tabs, own row pinned); rating delta line on
`Results.tsx` (polls once or twice, shows nothing if it never arrives); header link.

## Anti-cheat and privacy

New queries read only `games`, `game_players` and `player_ratings`. No board state leaves the server. Leaderboards
expose handle and display name only. Run `anti-cheat-reviewer` on the final diff.

## Testing

- Unit: equal players zero-sum, tie, 12-player bound, upset vs expected, damping floor, rating floor.
- Integration (PGlite): `rateGame` idempotent; concurrent rates resolve via version retry; <2 signed-in players
  skipped; `sweepUnrated` ordering; leaderboard includes a player after a single rated game, and friends scope.
- Component: stats panel, leaderboard page, results delta.
- No E2E unless requested.

## Risks

- Rating lags the game by a moment (or up to a day if the best-effort trigger fails).
- Anyone can create a table with friends, so ratings remain gameable beyond the damping; accepted for now.

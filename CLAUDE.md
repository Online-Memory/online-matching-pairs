<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Matching Pairs: notes for Claude

Turn-based memory game, one Next.js app on Vercel backed by Neon Postgres. Clients poll; the server decides everything.
`README.md` has the full architecture and the anti-cheat checklist.

## Map

- `src/server/engine/`: pure functions, `(state, action, now) → state + public events`. `applyAction`, `tick`,
  `toView` live in `engine.ts`; the state schema in `state.ts`.
- `src/server/tables/service.ts`: `TableService`: load row → `tick(now)` → engine action → compare-and-set save.
- `src/server/db/`: drivers (Neon, Postgres, PGlite), `tables.ts` (`table_state` + mirroring, incl. `is_public`/`player_count`/`host_name`), `history.ts`,
  `public-tables.ts` (the public directory), `ratings.ts` (all SQL for ratings, stats, leaderboards).
- `src/app/api/tables/[code]/*`: route handlers, thin wrappers over `TableService`.
- `src/server/ratings/`: `rating.ts` (pure pairwise Elo), `service.ts` (`RatingsService`: rate a finished game, sweep
  unrated ones, leaderboard, stats), `after.ts` (rates after the finishing response via `after()`). Friend ids come
  from `FriendsService.friendIds`. Routes: `src/app/api/leaderboard`, `src/app/api/me/stats`; the daily cron also
  sweeps unrated games. Client: `Leaderboard`, `StatsPanel`, `RatingChange`, `use-rating-change.ts`.
- `src/server/friends/service.ts`: `FriendsService`: profiles (`@handle`), presence heartbeat, friendships and lobby
  invites in `profiles`, `friendships`, `table_invites`. It never reads `table_state`; seating comes from
  `TableService.isSeatedInLobby`. Routes: `src/app/api/friends/*`, `src/app/api/me/{presence,handle}`,
  `src/app/api/tables/[code]/invites`. Client: `src/lib/client/use-friends.ts`.
- `src/lib/protocol/`: types shared by server and client. `src/lib/client/use-table.ts` is the only client code that
  talks to a table.
- `db/migrations/*.sql`: node-pg-migrate SQL files with `-- Up Migration` / `-- Down Migration` sections.

## Invariants (do not break)

- State leaves the server only through `toView(state, viewerId)`. Face-down tiles are exactly `{id, state}`.
- Everything under `src/server/` starts with `import "server-only"`. ESLint blocks importing it (or any DB driver) from
  components, `src/lib/client`, `src/lib/protocol`, pages and layouts. Don't weaken that rule.
- The engine stays pure: no I/O, no `Date.now()`, randomness only through the injected `Rng`. Deadlines are applied by
  `tick(now)`, never by timers.
- Saves are `UPDATE … WHERE version = $expected` with retry. Mirroring into `games`/`game_players` happens in the same
  statement (data-modifying CTEs). No interactive transactions: the Neon HTTP driver can't do them.
- History queries, the public directory (`GET /api/public-tables`) and ratings/stats/leaderboards read `games`,
  `game_players` and `player_ratings`, never `table_state`. A game is rated once: `games.rated_at` is claimed in the
  same single statement that updates every player's `player_ratings` row (version-checked, retried on conflict).
- Migrations are backward compatible (the old deployment serves until the new one is promoted) and immutable once
  committed. A hook blocks edits to existing migration files.

## Environments

- `.env.local` points at the **production** Neon branch; `.env.e2e.local` at the `e2e` branch. Never edit `.env*`
  files and never run `pnpm db:migrate` / `pnpm db:migrate:local` unless the user asks.
- For local work without services, `DATABASE_URL=pglite:./.pglite`. Vitest integration tests use in-memory PGlite
  unless `TEST_DATABASE_URL` is set.

## Commands

- CI order: `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test` (Vitest: unit, component and
  integration; about 6s in total). A Stop hook runs these when the tree has changes and blocks on failure.
- E2E: `pnpm build && pnpm test:e2e` (Playwright, PGlite). `pnpm test:e2e:neon` uses the Neon `e2e` branch.

## Working rules

- **Git is the user's call.** Never create branches or worktrees, commit or push unless the user explicitly asks in
  the current conversation. Leave changes uncommitted on the current branch and say what is ready to commit.
- **E2E only on demand.** Never run Playwright automatically or as part of verification. Run the `e2e` skill only
  when the user asks, or at wrap-up.
- **Wrap-up.** When the user says they're wrapping up ("done for today", "wrap up"): run `sync-docs`, then `e2e`, then
  report what is ready for them to commit.
- Use the `verify` skill before saying work is done.
- Use the `new-migration` skill for any schema change.
- Run the `anti-cheat-reviewer` agent when a diff touches `src/server/engine/`, `src/server/tables/`,
  `src/lib/protocol/`, `src/app/api/tables/`, `src/server/db/history.ts`, `src/server/db/public-tables.ts`, `src/server/db/ratings.ts`, `src/components/Tile.tsx` or
  `src/components/Board.tsx`.

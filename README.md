# Online Matching Pairs

A turn-based matching pairs (memory) game for 1–4 friends. It's one Next.js app deployed on Vercel, backed by Neon
Postgres. This is a rewrite of [`online-memory`](../online-memory), which ran on AWS AppSync, DynamoDB, Cognito and Lambda.

The server decides everything. A tile's picture never reaches a browser until that tile is turned over, so players
can't find pairs by reading the page source or watching network traffic.

## How it works

```
browser ── GET /api/tables/ABC234?since=41 (every ~1s while playing) ──▶ route handler
        ── POST /api/tables/ABC234/flip {tileId} ─────────────────────▶   │
                                                                         ▼
                              TableService: load row → tick(now) → engine action → compare-and-set save
                                                                         │
                                                       Neon: table_state (secret board, jsonb, version)
```

- **Engine** (`src/server/engine`) is a set of pure functions: `(state, action, now) → state + public events`.
  `tick(now)` applies every deadline that has passed (turn timeouts, flip-back after a miss, abandoning a table), each
  at the moment it fell due. Because of that, timers need no scheduler: every poll and action calls `tick` first.
- **Redaction**: `toView(state, viewer)` is the only way state leaves the server. Face-down tiles are `{id, state}`.
- **Concurrency**: each write is `UPDATE … WHERE version = $expected`. If another request saved in between, the
  service re-reads the row and tries again. Mirroring status into `games` and the roster into `game_players` happens
  in the same SQL statement (data-modifying CTEs), so no driver needs interactive transactions.
- **Client**: `useTable` (`src/lib/client/use-table.ts`) is the only code that talks to a table. It polls with
  `since`, applies snapshots, keeps recent events and sends actions. Push (SSE or WebSocket) could replace polling
  there without changing the engine or the UI.
- **Identity**: signed-in players use Neon Auth. Guests get a random id in an HMAC-signed httpOnly cookie.
- **Friends** (signed-in only): `FriendsService` keeps a unique `@handle` per account, mutual friendships
  (request, then accept) and lobby invites. Presence is a `last_seen_at` heartbeat sent every 30s from the layout;
  a friend counts as online for 75s after it. `GET /api/friends` is polled every 5s and carries no table state.
  Guests and deployments without Neon Auth get a 401 and no friends UI.
- **Public tables**: a host can list a table at creation (`isPublic`, fixed afterwards, private by default). `games`
  mirrors `is_public`, `player_count` and `host_name` in the same save statement, and `GET /api/public-tables`
  (no sign-in, polled every 5s by the home page) lists public lobbies and games in progress from `games` alone:
  code, theme, size, status, seats and host name, no board. Anyone can watch; joining stays lobby-only.
- **Ratings and leaderboards** (signed-in only): a finished game with 2+ signed-in players is rated with pairwise Elo
  (start 1000, floor 100; rematches within 24h count for less). `RatingsService` claims `games.rated_at` and updates
  every player's `player_ratings` row in one version-checked statement, right after the finishing response
  (`after()`); the daily cron rates anything missed. `GET /api/leaderboard` (global is public, friends needs sign-in)
  and `GET /api/me/stats` read only `games`, `game_players`, `player_ratings` and `profiles`, and expose handles
  and names, never account ids. Games finished before the feature shipped are not rated.

## Develop

```bash
nvm use            # Node 24 LTS
pnpm install
cp .env.example .env.local
```

To work without any services, set `DATABASE_URL=pglite:./.pglite` in `.env.local`. This runs an embedded Postgres
(PGlite) inside the dev server and migrates it on first use. Leave the `NEON_AUTH_*` variables empty and accounts are
switched off; guests can still play.

To use a Neon dev branch, set `DATABASE_URL` and `DATABASE_URL_UNPOOLED` to the branch, then run `pnpm db:migrate`.

| Script                                         | What it does                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm dev`                                     | Next dev server                                                                     |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint (with import boundaries), `tsc`, Prettier                                    |
| `pnpm test`                                    | Vitest: engine and property tests, TableService against Postgres, components        |
| `pnpm build && pnpm test:e2e`                  | Playwright against `next start` (in-memory PGlite unless `E2E_DATABASE_URL` is set) |
| `pnpm db:migrate`                              | `node-pg-migrate up` using `DATABASE_URL_UNPOOLED`                                  |
| `pnpm themes:slice [dir]`                      | Rebuild `public/themes` from the old app's sprite sheets                            |

Integration tests use `TEST_DATABASE_URL` when it's set (CI's Postgres, or a Neon branch). Otherwise they use
in-memory PGlite.

## Anti-cheat checklist

- The engine, the DB clients and auth live under `src/server/` with `import "server-only"`. ESLint blocks importing
  them, or any DB driver, from components, client libraries, protocol types and pages.
- Faces are shuffled with `crypto.randomInt`. The public event ring holds only public events.
- History queries, the public directory and the ratings/stats/leaderboard queries read only `games`, `game_players`,
  `player_ratings` and `profiles`, never `table_state`.
- A missed pair stays face up for 5s, long enough for a 1s poll to see it. Flips are rejected during that time. The
  player whose turn it is can end the wait early (`POST …/dismiss`, sent on a left click anywhere); for anyone else it
  does nothing, and an early click only shortens the wait to 1.5s so everyone's poll sees the pair.
- Theme pictures are one file per face, requested only once that face is shown.
- Tests: `toView` property tests; an integration test that plays a full 3-player game and scans every response; and a
  Playwright fixture on every E2E scenario. The fixture checks API bodies, image requests and the DOM of face-down
  tiles.

## Deploy (Vercel + Neon)

1. Import the repo in Vercel and add the **Neon** integration from the Vercel Marketplace. It sets `DATABASE_URL`
   and `DATABASE_URL_UNPOOLED` and creates a database branch for each preview.
2. Enable Neon Auth on the Neon project and set `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` (32+ chars). Add
   Google OAuth in the Neon Auth settings if you want "Continue with Google". Enable both variables for **Preview**
   as well as Production, or previews hide "Sign in" (set both or neither: with only one, `/api/me` fails). To
   sign in on a preview, also add its domain (`*-git-*-<team>.vercel.app`) to the Neon Auth trusted domains.
3. Set `GUEST_TOKEN_SECRET` (32+ chars) and `CRON_SECRET`.
4. `vercel.json` makes each build run `pnpm db:migrate` before `next build`, and registers a daily cleanup cron
   (`/api/cron/cleanup`). Write migrations so they stay backward compatible: the old deployment keeps serving
   until the new one is promoted.
5. Optional: add a Vercel Firewall rate-limit rule on `/api/tables/*` and `/api/public-tables`. The engine rejects flips that are inhumanly
   fast, but it can't throttle invalid requests, because a rejected request saves nothing.

## Not built yet

Badges, XP and daily streaks, and claiming guest games after signing up.

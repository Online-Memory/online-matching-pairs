# Public tables

## Goal

Let a host create a **public** table that appears in a browsable directory on the homepage. Anyone, signed in or
guest, can watch a public table (lobby or in progress) and join it while it is still a lobby. Private tables behave
exactly as today (join by code or friend invite).

## What already exists

- Watching: `GET /api/tables/[code]` already serves any caller; a non-seated viewer gets `youId: null` and a redacted
  `toView`. No spectator work is needed.
- Joining: lobby-only; the engine rejects joins after start with `already_started`. Unchanged.
- Guests: capped at 4 seats by `maxPlayersFor`. Unchanged. Guests may create and join public tables.

## Decisions

- Directory scope: public tables in `lobby` and `playing`. In-progress ones are watch-only (no mid-game join).
- Data source: **mirror into `games`** (approach A). The directory never reads `table_state`.
- Visibility is chosen at creation and never changes afterwards (YAGNI: no toggle on an existing table).
- Default is private.

## Design

### Schema (new migration, via the `new-migration` skill)

```sql
ALTER TABLE games ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN player_count int NOT NULL DEFAULT 1;
CREATE INDEX games_public_idx ON games (created_at DESC)
  WHERE is_public AND status IN ('lobby', 'playing');
```

Backward compatible: the old deployment never writes the columns, so its tables are private with a stale count,
which is harmless. Down migration drops the index and columns.

### Engine and state

- `GameState` gains `isPublic: boolean` with `.default(false)` in `gameStateSchema`, so rows saved before this
  change still parse.
- `TableSettings` gains `isPublic`; `createTable` copies it into state.
- `TableView` gains `isPublic` (so the table screen can show a "Public" badge). It is not secret.
- No new engine action. `isPublic` is immutable after creation.

### Persistence (`src/server/db/tables.ts`)

- `insertTable` writes `is_public` and `player_count` (initially 1) into `games`.
- `saveTable` mirrors `player_count` (players with `status !== "left"`) in the same statement, and adds it to the
  `IS DISTINCT FROM` tuple so joins and leaves update the list while ordinary moves still skip the `games` write.
- New `listPublicTables(db, now, limit)` in a new `src/server/db/public-tables.ts`. It selects from `games` only:
  `code, theme, pairs, max_players, player_count, host_name, status, created_at, started_at`. `game_players` is
  only written at game start, so the host's display name is mirrored too: the migration also adds
  `host_name text NOT NULL DEFAULT ''`, written by `insertTable` and refreshed by `saveTable` when the host
  changes (its tuple comparison includes `host_name`).
- Recency bound so stale rows don't linger (abandonment is only recorded when someone polls the table):
  lobbies with `created_at > now - RULES.lobbyIdleMs`, playing tables with `started_at > now - 2h`. Ordered by
  `created_at DESC`, `limit 50`.

### API

- `POST /api/tables`: `createTableRequestSchema` gains `isPublic: z.boolean().default(false)`. Passed through
  `TableService.create`.
- `GET /api/public-tables` (a sibling of `/api/tables`, so it can't collide with `[code]`): no auth required,
  `Cache-Control: no-store`, returns `PublicTablesResponse = { tables: PublicTableEntry[] }`.
- `PublicTableEntry = { code, theme, pairs, status: "lobby" | "playing", seats: { taken, max }, hostName }`.
  No tile, turn or player-list data.
- `TableService.listPublic()` wraps `listPublicTables` with the clock, keeping the route a thin wrapper.

### Client

- `src/lib/client/use-public-tables.ts`: polls the endpoint every 5s while the tab is visible and shares one
  poller, in the style of `use-friends.ts`.
- `src/components/PublicTables.tsx` on the homepage under the create/join forms. Each row shows theme, board size,
  host, seats `n/max`. Lobbies with a free seat link "Join"; full lobbies and in-progress games link "Watch". Both
  go to `/table/CODE`, where the existing join panel or spectator view applies. Empty state: "No public tables
  right now."
- `CreateTableForm` gets a "Public table" checkbox (default off) with a one-line hint that it will be listed.

## Anti-cheat and privacy

- The directory exposes only fields already visible to any watcher via `toView`, plus the host name. No hidden
  faces, no player list.
- `listPublicTables` reads `games` only, per the history invariant. Everything stays under `src/server/` with
  `import "server-only"`.
- Public tables make the host's display name discoverable by strangers. For signed-in hosts this is the account
  name already shown inside the table; the create form's hint says the table is listed. A guest uses the chosen
  guest name.
- Abuse: the list is capped at 50 and public tables are subject to the same per-table limits. Request-level flood
  protection stays in front of the app, as documented in `RULES`.

## Testing

- Engine: `createTable` sets `isPublic`; state without the field parses as private.
- Persistence (PGlite integration): public table appears in the list; private never does; join and leave change
  `player_count`; start moves it to `playing`; finished and abandoned disappear; recency bound; limit.
- Route: `GET /api/public-tables` as guest and signed in; `POST /api/tables` with and without `isPublic`;
  response never contains `tiles`/`faces`.
- Components: `PublicTables` rows (Join vs Watch, empty state), `CreateTableForm` toggle.
- Anti-cheat reviewer on the diff (touches engine, tables, protocol, tables routes). E2E only when asked.

## Out of scope

Mid-game joining, spectator counts, search or filters, changing visibility after creation, moderation tools.

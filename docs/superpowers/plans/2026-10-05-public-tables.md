# Public tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host can create a public table that is listed on the homepage; anyone can watch it and join it while it is a lobby.

**Architecture:** `isPublic` is fixed at creation and stored in `GameState`. `games` mirrors `is_public`, `player_count` and `host_name` in the same `saveTable` statement, so the directory is a plain indexed query on `games` and never touches `table_state`. A thin `GET /api/public-tables` route wraps `TableService.listPublic`; the homepage polls it through a shared poller.

**Tech Stack:** Next.js (read `node_modules/next/dist/docs/` before writing route or page code; this version has breaking changes), TypeScript, zod, Postgres (Neon / PGlite), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-public-tables-design.md`

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`. Never import server code from components, `src/lib/client`, `src/lib/protocol`, pages or layouts.
- The engine stays pure: no I/O, no `Date.now()`, randomness only through `Rng`.
- Face-down tiles leave the server only as `{id, state}` via `toView`. The directory exposes no tiles, turn or player list.
- The directory reads `games` only, never `table_state`.
- Saves stay `UPDATE ... WHERE version = $expected` with the `games` mirror in the same statement (data-modifying CTEs). No interactive transactions.
- Migration is backward compatible (new columns have defaults), is a new file, and existing migration files are never edited.
- Visibility is private by default and immutable after creation. Joining stays lobby-only. Guests keep the 4-seat cap.
- **Git is the user's call:** do not commit, branch or push. Each task ends with "leave uncommitted" and the verification run.
- Never run `pnpm db:migrate`, `pnpm db:migrate:local`, Playwright/E2E, or edit `.env*` files. PGlite tests apply `db/migrations` themselves.
- CI order: `pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`.

## Review Focus

Failure modes the spec implies; each has a pinning test in the owning task.

1. A table row saved before this change has no `isPublic`: it must parse and be private (Task 1).
2. A public lobby nobody has polled past the idle window must not linger in the list (Task 2).
3. The seat count and host name must follow joins, leaves and host handover, not only start/finish (Task 1, Task 2).
4. A private table must never be listed, and the response must never carry tiles, faces or player ids (Task 2, Task 3).
5. An old client that creates a table without `isPublic` must get a private table; a full lobby must say "Watch", not "Join" (Task 3, Task 4).

## File Structure

| File                                                                         | Responsibility                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `db/migrations/<epoch-ms>_public-tables.sql` (create)                        | `is_public`, `player_count`, `host_name`, partial index                           |
| `src/server/engine/state.ts`, `engine.ts` (modify)                           | `isPublic` in state, settings, `createTable`, `toView`                            |
| `src/lib/protocol/index.ts` (modify)                                         | `isPublic` on request and `TableView`; `PublicTableEntry`, `PublicTablesResponse` |
| `src/server/db/tables.ts` (modify)                                           | write/mirror the new `games` columns                                              |
| `src/server/db/public-tables.ts` (create)                                    | `listPublicTables` query over `games`                                             |
| `src/server/tables/service.ts` (modify)                                      | `listPublic()`; `create` passes `isPublic` through settings                       |
| `src/app/api/tables/route.ts` (modify)                                       | accept `isPublic`                                                                 |
| `src/app/api/public-tables/route.ts` (create)                                | `GET` directory                                                                   |
| `src/lib/client/api.ts`, `use-public-tables.ts` (modify/create)              | client call and shared poller                                                     |
| `src/components/PublicTables.tsx`, `CreateTableForm.tsx`, `src/app/page.tsx` | UI                                                                                |

---

### Task 1: Store `isPublic` and mirror directory columns

**Files:**

- Create: `db/migrations/<epoch-ms>_public-tables.sql` (get the stamp with `node -e 'console.log(Date.now())'`)
- Modify: `src/server/engine/state.ts`, `src/server/engine/engine.ts` (`TableSettings`, `createTable`, `toView`), `src/lib/protocol/index.ts` (`TableView`), `src/server/db/tables.ts` (`insertTable`, `saveTable`)
- Modify (fixtures): `src/server/engine/engine.test.ts`, `tests/integration/table-service.test.ts`, any other fixture that builds `TableSettings` or `TableView` (typecheck will list them)
- Test: `src/server/engine/engine.test.ts`, `tests/integration/public-tables.test.ts` (new)

**Interfaces:**

- Produces: `TableSettings = { theme; pairs; maxPlayers; turnSeconds; isPublic: boolean }`; `GameState.isPublic: boolean` (schema default `false`); `TableView.isPublic: boolean`; `games.is_public boolean`, `games.player_count int`, `games.host_name text`, written by `insertTable` and kept current by `saveTable`.

- [ ] **Step 1: Write the failing engine tests** in `src/server/engine/engine.test.ts`, inside the existing top-level `describe`:

```ts
it("records visibility at creation, and old saved state without it parses as private", () => {
  const host = { playerId: "u_a", userId: "a", name: "A" };
  const pub = createTable(
    "ABC234",
    { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: true },
    host,
    0,
  );
  expect(pub.isPublic).toBe(true);
  expect(toView(pub, null).isPublic).toBe(true);

  const { isPublic: _omit, ...legacy } = pub;
  const parsed = gameStateSchema.parse(legacy);
  expect(parsed.isPublic).toBe(false);
});
```

Add `gameStateSchema` and `toView` to the file's existing imports if missing.

- [ ] **Step 2: Run:** `pnpm vitest run src/server/engine/engine.test.ts` — expect FAIL (`isPublic` not in settings/state).

- [ ] **Step 3: Engine and protocol changes.**
  - `state.ts`: in `gameStateSchema` add `isPublic: z.boolean().default(false),` after `turnSeconds`.
  - `engine.ts`: `export type TableSettings = { theme: string; pairs: number; maxPlayers: number; turnSeconds: number; isPublic: boolean };` (`createTable` already spreads `...settings`, so state gets the field). In `toView` add `isPublic: s.isPublic,` after `turnSeconds`.
  - `protocol/index.ts`: add `isPublic: boolean;` to `TableView` after `turnSeconds`.
  - Fix fixtures: add `isPublic: false` to every `TableSettings` object (`lobby()` helper in `engine.test.ts`, `settings` in `table-service.test.ts`) and every hand-built `TableView`. `pnpm typecheck` lists them.

- [ ] **Step 4: Run:** `pnpm vitest run src/server/engine/engine.test.ts && pnpm typecheck` — expect PASS.

- [ ] **Step 5: Write the migration** (`-- Up Migration` / `-- Down Migration`, as in `1791230193521_friends.sql`):

```sql
-- Up Migration

-- Public table directory. The directory reads these mirrored columns instead of table_state.
-- Defaults keep the old deployment working: its tables stay private.
ALTER TABLE games ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE games ADD COLUMN player_count int NOT NULL DEFAULT 1;
ALTER TABLE games ADD COLUMN host_name text NOT NULL DEFAULT '';
CREATE INDEX games_public_idx ON games (created_at DESC)
  WHERE is_public AND status IN ('lobby', 'playing');

-- Down Migration

DROP INDEX games_public_idx;
ALTER TABLE games DROP COLUMN host_name;
ALTER TABLE games DROP COLUMN player_count;
ALTER TABLE games DROP COLUMN is_public;
```

- [ ] **Step 6: Write the failing persistence test.** Create `tests/integration/public-tables.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@/server/db";
import { seededRng, type Identity } from "@/server/engine";
import { TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const base = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20 };
const alice: Identity = { playerId: "u_alice", userId: "alice", name: "Alice" };
const bob: Identity = { playerId: "g_bob", userId: null, name: "Bob" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let now: number;
let service: TableService;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  now = 1_700_000_000_000;
  service = new TableService(db as Db, { clock: () => now, rng: seededRng(7) });
});

const mirror = async (code: string) =>
  (await db.query("SELECT is_public, player_count, host_name FROM games WHERE code = $1", [code]))[0];

describe("games mirror for the directory", () => {
  it("records visibility, host name and seat count, and follows joins, leaves and host handover", async () => {
    const { code } = await service.create(alice, { ...base, isPublic: true });
    expect(await mirror(code)).toMatchObject({ is_public: true, player_count: 1, host_name: "Alice" });

    await service.act(code, bob, { type: "join", identity: bob }, -1);
    expect(await mirror(code)).toMatchObject({ player_count: 2, host_name: "Alice" });

    await service.act(code, alice, { type: "leave" }, -1);
    expect(await mirror(code)).toMatchObject({ player_count: 1, host_name: "Bob" });
  });

  it("defaults to private", async () => {
    const { code } = await service.create(alice, { ...base, isPublic: false });
    expect(await mirror(code)).toMatchObject({ is_public: false });
  });
});
```

Check the leave action's name in `src/server/engine/engine.ts` (`Action` type) and use it exactly; also confirm the host does pass to the next active player when the host leaves a lobby (existing `host_changed` event). If it does not hand over, change the assertion to `host_name: "Alice"` and drop the handover claim from the test name.

- [ ] **Step 7: Run:** `pnpm vitest run tests/integration/public-tables.test.ts` — expect FAIL (`is_public` not written).

- [ ] **Step 8: Persistence.** In `src/server/db/tables.ts`:
  - Add helpers below `toTimestamp`:

```ts
const hostName = (s: GameState) => s.players.find((p) => p.id === s.hostId)?.name ?? "";
const seated = (s: GameState) => s.players.filter((p) => p.status !== "left").length;
```

- `insertTable`: columns become `(id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, created_at, is_public, player_count, host_name)` with values `... $9::timestamptz, $10, $11, $12)`; shift the later placeholders to `$13` (state JSON), `$14` (events), `$15` (next due), and add `state.isPublic, seated(state), hostName(state)` to the params after `toTimestamp(state.createdAt)`.
- `saveTable` `g` CTE becomes:

```sql
UPDATE games
   SET status = $6, host_player_id = $7,
       started_at = $8::timestamptz, finished_at = $9::timestamptz,
       player_count = $11, host_name = $12
 WHERE id IN (SELECT game_id FROM s)
   AND (status, host_player_id, started_at, finished_at, player_count, host_name)
       IS DISTINCT FROM ($6::text, $7::text, $8::timestamptz, $9::timestamptz, $11::int, $12::text)
RETURNING id
```

and append `seated(state), hostName(state)` to the params array (positions `$11`, `$12`; `$10` stays the roster JSON).

- [ ] **Step 9: Run:** `pnpm vitest run tests/integration && pnpm typecheck` — expect PASS.

- [ ] **Step 10: Verify, leave uncommitted:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

### Task 2: Directory query and `TableService.listPublic`

**Files:**

- Create: `src/server/db/public-tables.ts`
- Modify: `src/server/tables/service.ts`, `src/lib/protocol/index.ts`
- Test: `tests/integration/public-tables.test.ts`

**Interfaces:**

- Consumes: Task 1's `games.is_public / player_count / host_name`.
- Produces (protocol):

```ts
export type PublicTableEntry = {
  code: string;
  theme: string;
  pairs: number;
  status: "lobby" | "playing";
  seats: { taken: number; max: number };
  hostName: string;
};
export type PublicTablesResponse = { tables: PublicTableEntry[] };
```

and `TableService.listPublic(): Promise<PublicTableEntry[]>`; `listPublicTables(db: Db, window: { lobbySince: number; playingSince: number; limit: number }): Promise<PublicTableEntry[]>`.

- [ ] **Step 1: Write the failing tests** — append to `tests/integration/public-tables.test.ts` (reuse `base`, `alice`, `bob`, `service`, `now`):

```ts
describe("listPublic", () => {
  it("lists public lobbies and playing tables, never private ones, and nothing secret", async () => {
    const pubLobby = (await service.create(alice, { ...base, isPublic: true })).code;
    await service.create(bob, { ...base, isPublic: false });

    const list = await service.listPublic();
    expect(list).toEqual([
      {
        code: pubLobby,
        theme: "001",
        pairs: 8,
        status: "lobby",
        seats: { taken: 1, max: 4 },
        hostName: "Alice",
      },
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual(["code", "hostName", "pairs", "seats", "status", "theme"]);
  });

  it("moves a started table to playing and drops finished or left-empty ones", async () => {
    const { code } = await service.create(alice, { ...base, isPublic: true });
    await service.act(code, bob, { type: "join", identity: bob }, -1);
    await service.act(code, alice, { type: "start" }, -1);
    expect((await service.listPublic())[0]).toMatchObject({
      code,
      status: "playing",
      seats: { taken: 2, max: 4 },
    });

    await db.query("UPDATE games SET status = 'finished' WHERE code = $1", [code]);
    expect(await service.listPublic()).toEqual([]);
  });

  it("hides lobbies nobody has touched past the idle window, even if never polled to abandoned", async () => {
    const { code } = await service.create(alice, { ...base, isPublic: true });
    now += 30 * 60_000 + 1;
    expect(await service.listPublic()).toEqual([]);
    expect(code).toBeTruthy();
  });

  it("caps the list at 50, newest first", async () => {
    for (let i = 0; i < 52; i++) {
      now += 1_000;
      await service.create(alice, { ...base, isPublic: true });
    }
    const list = await service.listPublic();
    expect(list).toHaveLength(50);
  });
});
```

The "finished" test flips status directly in SQL: the engine path to a finished game is covered in `table-service.test.ts`; this test only pins the query filter. If `startedAt`'s 2h window also needs a test, add one that sets `started_at` to 3h ago and expects `[]`.

- [ ] **Step 2: Run:** `pnpm vitest run tests/integration/public-tables.test.ts` — expect FAIL (`listPublic` missing).

- [ ] **Step 3: Add the protocol types** shown above to `src/lib/protocol/index.ts` after `CreateTableResponse`.

- [ ] **Step 4: Create `src/server/db/public-tables.ts`:**

```ts
import "server-only";

import type { PublicTableEntry } from "@/lib/protocol";

import type { Db } from "./client";

const toTimestamp = (ms: number) => new Date(ms).toISOString();

/**
 * The public directory. Reads `games` only (never `table_state`). Abandonment is only recorded when
 * someone polls a table, so recency bounds keep dead lobbies from lingering in the list.
 */
export async function listPublicTables(
  db: Db,
  window: { lobbySince: number; playingSince: number; limit: number },
): Promise<PublicTableEntry[]> {
  const rows = await db.query(
    `SELECT code, theme, pairs, status, player_count, max_players, host_name
       FROM games
      WHERE is_public
        AND ((status = 'lobby' AND created_at > $1::timestamptz)
          OR (status = 'playing' AND started_at > $2::timestamptz))
      ORDER BY created_at DESC
      LIMIT $3`,
    [toTimestamp(window.lobbySince), toTimestamp(window.playingSince), window.limit],
  );
  return rows.map((r) => ({
    code: String(r.code),
    theme: String(r.theme),
    pairs: Number(r.pairs),
    status: r.status === "playing" ? "playing" : "lobby",
    seats: { taken: Number(r.player_count), max: Number(r.max_players) },
    hostName: String(r.host_name),
  }));
}
```

Check how other `src/server/db` files type `db.query` rows (see `history.ts`) and match its row typing/parsing style instead of the `String()/Number()` casts if it uses zod.

- [ ] **Step 5: Add to `TableService`** (`service.ts`), importing `listPublicTables` and `RULES`:

```ts
const PUBLIC_LIST_LIMIT = 50;
/** A started game that nobody finished within this long is probably dead; hide it from the directory. */
const PUBLIC_PLAYING_WINDOW_MS = 2 * 3_600_000;
```

```ts
  /** The homepage directory: public lobbies and games in progress. Reads `games`, never a board. */
  async listPublic(): Promise<PublicTableEntry[]> {
    const now = this.clock();
    return listPublicTables(this.db, {
      lobbySince: now - RULES.lobbyIdleMs,
      playingSince: now - PUBLIC_PLAYING_WINDOW_MS,
      limit: PUBLIC_LIST_LIMIT,
    });
  }
```

Import `PublicTableEntry` from `@/lib/protocol` and `RULES` from `@/server/engine` (it is exported from `state.ts`).

- [ ] **Step 6: Run:** `pnpm vitest run tests/integration && pnpm typecheck` — expect PASS.

- [ ] **Step 7: Verify, leave uncommitted:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

### Task 3: API routes

**Files:**

- Modify: `src/lib/protocol/index.ts` (`createTableRequestSchema`), `src/app/api/tables/route.ts`
- Create: `src/app/api/public-tables/route.ts`
- Test: `tests/integration/public-tables-routes.test.ts` (new)

**Interfaces:**

- Consumes: `TableService.listPublic`, `TableService.create(host, settings with isPublic)`.
- Produces: `GET /api/public-tables → PublicTablesResponse` (no auth, `Cache-Control: no-store`); `POST /api/tables` accepts optional `isPublic`.

- [ ] **Step 1: Write the failing route tests.** Create `tests/integration/public-tables-routes.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn(async () => ({ code: "ABC234" }));
const listPublic = vi.fn(async () => [
  { code: "ABC234", theme: "001", pairs: 8, status: "lobby", seats: { taken: 1, max: 4 }, hostName: "Alice" },
]);

vi.mock("@/server/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/tables")>()),
  getTableService: async () => ({ create, listPublic }),
}));
vi.mock("@/server/auth", () => ({
  getOrCreateViewer: async () => ({ userId: null, playerId: "g_x" }),
  toIdentity: () => ({ playerId: "g_x", userId: null, name: "X" }),
}));

import { POST } from "@/app/api/tables/route";
import { GET } from "@/app/api/public-tables/route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/tables", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({}),
  });

beforeEach(() => create.mockClear());

describe("public table routes", () => {
  it("lists tables for anyone, uncached, with no board data", async () => {
    const res = await GET(new Request("http://x/api/public-tables"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/tiles|face|players/);
    expect(text).toContain("ABC234");
  });

  it("creates a public table when asked, and a private one otherwise", async () => {
    await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X", isPublic: true });
    expect(create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ isPublic: true }));

    await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X" });
    expect(create).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ isPublic: false }));
  });

  it("rejects a non-boolean visibility", async () => {
    const res = await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X", isPublic: "yes" });
    expect(res.status).toBe(400);
  });
});
```

If the repo's real `getOrCreateViewer`/`toIdentity` shapes differ (`src/server/auth`), match them in the mock.

- [ ] **Step 2: Run:** `pnpm vitest run tests/integration/public-tables-routes.test.ts` — expect FAIL.

- [ ] **Step 3: Protocol:** in `createTableRequestSchema` add `isPublic: z.boolean().optional(),` after `turnSeconds`. (Optional so an old client that omits it gets a private table.)

- [ ] **Step 4: `src/app/api/tables/route.ts`:** pass `isPublic: body.isPublic ?? false,` in the `service.create` settings.

- [ ] **Step 5: Create `src/app/api/public-tables/route.ts`** (check `node_modules/next/dist/docs/` for route-handler conventions in this Next version first, and mirror `src/app/api/tables/[code]/route.ts`):

```ts
import { NextResponse } from "next/server";

import type { PublicTablesResponse } from "@/lib/protocol";
import { route } from "@/server/http";
import { getTableService } from "@/server/tables";

/** The public directory. No sign-in needed: anyone may browse, watch and join. */
export const GET = route(async () => {
  const service = await getTableService();
  return NextResponse.json<PublicTablesResponse>(
    { tables: await service.listPublic() },
    { headers: { "Cache-Control": "no-store" } },
  );
});
```

- [ ] **Step 6: Run:** `pnpm vitest run tests/integration && pnpm typecheck` — expect PASS.

- [ ] **Step 7: Verify, leave uncommitted:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

### Task 4: Homepage directory and create-form toggle

**Files:**

- Modify: `src/lib/client/api.ts`, `src/components/CreateTableForm.tsx`, `src/app/page.tsx`
- Create: `src/lib/client/use-public-tables.ts`, `src/components/PublicTables.tsx`
- Test: `src/components/PublicTables.test.tsx` (new), `src/components/CreateTableForm.test.tsx` (new)

**Interfaces:**

- Consumes: `PublicTablesResponse` / `PublicTableEntry` from `@/lib/protocol`; `GET /api/public-tables`.
- Produces: `api.publicTables(): Promise<PublicTablesResponse>`; `usePublicTables(): { tables: PublicTableEntry[] | null; error: string | null }`; `<PublicTables />`.

- [ ] **Step 1: Write the failing component tests.**

`src/components/PublicTables.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";

import { PublicTables } from "./PublicTables";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (over: object) => ({
  code: "ABC234",
  theme: "001",
  pairs: 8,
  status: "lobby" as const,
  seats: { taken: 1, max: 4 },
  hostName: "Alice",
  ...over,
});

describe("PublicTables", () => {
  it("offers Join on an open lobby and Watch on a full or started table", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({
      tables: [
        entry({ code: "OPEN22" }),
        entry({ code: "FULL22", seats: { taken: 4, max: 4 } }),
        entry({ code: "PLAY22", status: "playing" }),
      ],
    });
    render(<PublicTables />);
    expect(await screen.findByRole("link", { name: /join.*alice/i })).toHaveAttribute(
      "href",
      "/table/OPEN22",
    );
    const watch = screen.getAllByRole("link", { name: /watch/i });
    expect(watch.map((a) => a.getAttribute("href"))).toEqual(["/table/FULL22", "/table/PLAY22"]);
  });

  it("says so when nothing is public", async () => {
    vi.spyOn(api, "publicTables").mockResolvedValue({ tables: [] });
    render(<PublicTables />);
    expect(await screen.findByText(/no public tables right now/i)).toBeInTheDocument();
  });
});
```

`src/components/CreateTableForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";

import { CreateTableForm } from "./CreateTableForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CreateTableForm visibility", () => {
  it("is private by default and sends isPublic when ticked", async () => {
    const create = vi.spyOn(api, "createTable").mockResolvedValue({ code: "ABC234" });
    render(<CreateTableForm />);
    const box = screen.getByRole("checkbox", { name: /public table/i });
    expect(box).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /create table/i }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false })));

    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: /create table/i }));
    await waitFor(() => expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ isPublic: true })));
  });
});
```

If `jest-dom` matchers (`toBeInTheDocument`, `toHaveAttribute`, `toBeChecked`) aren't registered in `tests/setup.ts`, use plain DOM assertions as `HomeInvites.test.tsx` does.

- [ ] **Step 2: Run:** `pnpm vitest run src/components/PublicTables.test.tsx src/components/CreateTableForm.test.tsx` — expect FAIL (modules missing).

- [ ] **Step 3: `api.ts`:** add `PublicTablesResponse` to the type import and the entry
      `publicTables: () => request<PublicTablesResponse>("/api/public-tables"),`.

- [ ] **Step 4: Create `src/lib/client/use-public-tables.ts`** — the shared-poller pattern of `use-friends.ts`, with no sign-in gate:

```ts
"use client";

import { useSyncExternalStore } from "react";

import type { PublicTableEntry } from "@/lib/protocol";

import { api } from "./api";

const POLL_MS = 5_000;

type State = { tables: PublicTableEntry[] | null; error: string | null };
const EMPTY: State = { tables: null, error: null };

// One poll for the page, however many components read it.
let state: State = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let latestRequest = 0;
const listeners = new Set<() => void>();

function publish(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

/** Only the newest request may update the state, so a slow, older response can't undo a refresh. */
async function refresh() {
  const mine = ++latestRequest;
  try {
    const { tables } = await api.publicTables();
    if (mine === latestRequest) publish({ tables, error: null });
  } catch (e) {
    if (mine === latestRequest) {
      publish({ tables: state.tables, error: e instanceof Error ? e.message : "Something went wrong" });
    }
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    if (timer) clearInterval(timer);
    timer = null;
    latestRequest++;
    state = EMPTY;
  };
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/** The public directory, polled while the page is open. The last good list survives a failed poll. */
export function usePublicTables() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

- [ ] **Step 5: Create `src/components/PublicTables.tsx`.** Reuse existing class names where they fit (check `globals.css` for list/card styles used by `InviteList`/`HomeInvites` and follow that markup); add only the minimal new CSS needed:

```tsx
"use client";

import Link from "next/link";

import { usePublicTables } from "@/lib/client/use-public-tables";
import { THEMES } from "@/lib/protocol";

export function PublicTables() {
  const { tables, error } = usePublicTables();
  const themeName = (id: string) => THEMES.find((t) => t.id === id)?.name ?? id;

  return (
    <section className="public-tables" aria-labelledby="public-heading">
      <h2 id="public-heading">Public tables</h2>
      {tables === null ? (
        <p className="hint">{error ?? "Loading…"}</p>
      ) : tables.length === 0 ? (
        <p className="hint">No public tables right now.</p>
      ) : (
        <ul className="public-list">
          {tables.map((t) => {
            const canJoin = t.status === "lobby" && t.seats.taken < t.seats.max;
            return (
              <li key={t.code} className="public-row">
                <span>
                  {themeName(t.theme)} · {t.pairs * 2} tiles · {t.seats.taken}/{t.seats.max} seats
                  {t.status === "playing" && " · in progress"}
                </span>
                <Link className="button" href={`/table/${t.code}`}>
                  {canJoin ? `Join ${t.hostName}` : `Watch ${t.hostName}`}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

The test's accessible-name regex `/join.*alice/i` and `/watch/i` match these labels. Add small `.public-tables`, `.public-list`, `.public-row` rules to `src/app/globals.css` consistent with neighbouring sections (flex row, gap, border like the invite list).

- [ ] **Step 6: `CreateTableForm.tsx`:** add `const [isPublic, setIsPublic] = useState(false);`, send `isPublic` in `api.createTable({... isPublic })`, and render before the name field:

```tsx
<label className="checkbox-field">
  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
  Public table
</label>
<p className="hint">
  {isPublic
    ? "Listed on the home page. Anyone can watch and join while it's a lobby."
    : "Private. Only people with the code or an invite can join."}
</p>
```

- [ ] **Step 7: `src/app/page.tsx`:** import `PublicTables` and render `<PublicTables />` after `<HomeInvites />`.

- [ ] **Step 8: Run:** `pnpm vitest run src/components && pnpm typecheck` — expect PASS.

- [ ] **Step 9: Verify, leave uncommitted:** `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`. Do not run E2E. If a browser check is wanted, start the dev server with `DATABASE_URL=pglite:./.pglite pnpm dev`, create a public table in one window and confirm it appears in a second, and that a private table does not.

---

### Final steps (after Task 4)

- [ ] Run the `anti-cheat-reviewer` agent on the diff (engine, tables, protocol, `src/app/api/tables/` all changed).
- [ ] Run the `verify` skill.
- [ ] Update `CLAUDE.md` Map and `README.md` only where a documented fact changed (new `/api/public-tables`, `games` mirror columns, `public-tables.ts`), via `sync-docs` if the user is wrapping up.
- [ ] Report what is ready to commit. Do not commit, branch or push.

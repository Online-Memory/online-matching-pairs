# Friends, Presence and Table Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in players keep a mutual friends list (added by unique `@handle`), see which friends are online, and invite friends to a lobby.

**Architecture:** A new `FriendsService` (same shape as `TableService`: `Db` + injected clock, single-statement writes, `import "server-only"`) over three new tables. Presence is a `last_seen_at` heartbeat in Postgres. The client polls one `GET /api/friends` payload and sends a heartbeat from the root layout. Table state is never read or returned, so the engine and `toView` are untouched.

**Tech Stack:** Next.js 16 route handlers, Postgres via the `Db` interface (Neon / pg / PGlite), zod 4, Vitest (node integration on PGlite, jsdom component tests), React 19.

**Spec:** `docs/superpowers/specs/2026-10-05-friends-presence-design.md`

## Global Constraints

- Everything under `src/server/` starts with `import "server-only"`. Do not import server code or DB drivers from components, `src/lib/client`, `src/lib/protocol`, pages or layouts. Do not weaken the ESLint rule.
- The engine stays pure; this feature does not touch `src/server/engine/`.
- Saves are single parameterised statements (`Db.query`); no interactive transactions (Neon HTTP driver).
- History and friends queries read only public tables (`games`, `game_players`, `profiles`, `friendships`, `table_invites`), never `table_state`.
- Migrations are additive and backward compatible, and immutable once committed. Use the `new-migration` skill. Never run `pnpm db:migrate` or `pnpm db:migrate:local`; never edit `.env*`.
- Presence is online when `now - last_seen_at < 75_000` ms. Heartbeat every 30s while visible. Friends poll every 5s. Invites expire after 10 minutes.
- Handle format: `^[a-z0-9_]{3,20}$`, stored lowercase. Maximum 30 outgoing pending requests per user.
- Only signed-in users. Guests and auth-disabled mode get `401 unauthorized` from the routes and no UI.
- Git is the user's call: **do not commit, branch or push**. Every "checkpoint" step below only runs checks. Report what is ready to commit at the end.
- E2E (Playwright) only when the user asks.
- Run the `anti-cheat-reviewer` agent at the end (diff touches `src/app/api/tables/` and `src/lib/protocol/`), and the `verify` skill before saying done.
- `CLAUDE.md` warns this Next.js has breaking changes: before writing route handlers or layout code, skim the relevant guide in `node_modules/next/dist/docs/`. Match the existing routes (`src/app/api/tables/[code]/join/route.ts`) for the `params: Promise<...>` context shape.

## Review Focus

Inputs the spec implies that no happy-path task exercises, most likely first. Each has a test in the owning task.

1. Two users send each other a request at nearly the same time, or the same user sends twice: one row, ends accepted or stays pending, never an error or duplicate. (Task 3)
2. Friend removed while an invite is open: the invite must disappear for the recipient. (Task 3, 4)
3. Handle typed with uppercase, spaces or `@`: `@Sonny ` finds `sonny`. Invalid handle gives `bad_request`, taken handle gives `bad_request`. (Task 2, 3)
4. Two accounts with the same display name (or a name with no usable characters) both get valid, distinct suggested handles. (Task 2)
5. A player who left or whose game started or ended must not be able to invite (invites only for a seated player in a `lobby` game). (Task 4)

## File Structure

| File                                                                                                 | Responsibility                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `db/migrations/1791233000000_friends.sql` (new)                                                      | `profiles`, `friendships`, `table_invites`                          |
| `tests/integration/db.ts` (modify)                                                                   | `reset()` also truncates the new tables                             |
| `src/lib/protocol/index.ts` (modify)                                                                 | `handleSchema`, request schemas, `FriendsResponse` and entry types  |
| `src/server/friends/service.ts` (new)                                                                | `FriendsService`: profiles, presence, friendships, invites, cleanup |
| `src/server/friends/index.ts` (new)                                                                  | `getFriendsService()`, `requireAccount()`                           |
| `src/app/api/friends/route.ts` (new)                                                                 | `GET` poll payload                                                  |
| `src/app/api/friends/requests/route.ts` (new)                                                        | `POST` send request                                                 |
| `src/app/api/friends/[userId]/route.ts` (new)                                                        | `PATCH` accept, `DELETE` remove                                     |
| `src/app/api/friends/invites/[id]/route.ts` (new)                                                    | `DELETE` dismiss invite                                             |
| `src/app/api/me/presence/route.ts` (new)                                                             | `PUT` heartbeat                                                     |
| `src/app/api/me/handle/route.ts` (new)                                                               | `PUT` set handle                                                    |
| `src/app/api/tables/[code]/invites/route.ts` (new)                                                   | `POST` invite a friend                                              |
| `src/app/api/cron/cleanup/route.ts` (modify)                                                         | also sweeps expired invites                                         |
| `src/lib/client/api.ts` (modify)                                                                     | friends methods                                                     |
| `src/lib/client/use-friends.ts` (new)                                                                | polling hook + heartbeat hook                                       |
| `src/components/PresenceBeat.tsx` (new)                                                              | mounts the heartbeat in the layout                                  |
| `src/components/FriendsPanel.tsx` (new)                                                              | home-page panel                                                     |
| `src/components/InviteFriends.tsx` (new)                                                             | lobby invite picker                                                 |
| `src/app/layout.tsx`, `src/app/page.tsx`, `src/components/Lobby.tsx`, `src/app/globals.css` (modify) | wiring and styles                                                   |
| `tests/integration/friends-service.test.ts` (new)                                                    | service tests                                                       |
| `src/components/FriendsPanel.test.tsx` (new)                                                         | component test                                                      |

Deviations from the spec, deliberate: the unique index is on a lowercase-checked `handle` column instead of `lower(handle)`; abuse is bounded by the 30-pending-request cap (`rate_limited`) rather than a time-based limiter, because serverless has no shared memory; handle existence is intentionally discoverable by exact match, so unknown handle returns `not_found`; invites are lobby-only, since joining a started game is rejected anyway.

---

### Task 1: Migration, test-db reset, protocol types

**Files:**

- Create: `db/migrations/1791233000000_friends.sql`
- Modify: `tests/integration/db.ts`
- Modify: `src/lib/protocol/index.ts` (append after `MeResponse`)

**Interfaces:**

- Produces: tables `profiles`, `friendships`, `table_invites`; exports `handleSchema`, `friendRequestSchema`, `setHandleSchema`, `inviteRequestSchema`, types `FriendEntry`, `FriendRequestEntry`, `InviteEntry`, `FriendsResponse`.

- [ ] **Step 1: Invoke the `new-migration` skill and create the migration**

```sql
-- Up Migration

CREATE TABLE profiles (
  user_id text PRIMARY KEY,
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE friendships (
  user_a text NOT NULL,
  user_b text NOT NULL,
  requested_by text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (requested_by IN (user_a, user_b))
);
CREATE INDEX friendships_user_b_idx ON friendships (user_b);

CREATE TABLE table_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_code text NOT NULL,
  from_user text NOT NULL,
  to_user text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (table_code, to_user)
);
CREATE INDEX table_invites_to_user_idx ON table_invites (to_user, expires_at);

-- Down Migration

DROP TABLE table_invites;
DROP TABLE friendships;
DROP TABLE profiles;
```

- [ ] **Step 2: Reset the new tables between tests.** In `tests/integration/db.ts` replace both `TRUNCATE games CASCADE` strings with `TRUNCATE games, profiles, friendships, table_invites CASCADE`.

- [ ] **Step 3: Add protocol types.** Check how `src/lib/protocol/index.ts` imports zod (it already defines `joinRequestSchema`), then append:

```ts
/** Handles are what people search for. Input is forgiving (`@Sonny ` -> `sonny`); storage is canonical. */
export const handleSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/^@/, "").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_]{3,20}$/, "Handles are 3-20 letters, numbers or underscores"));

export const friendRequestSchema = z.object({ handle: handleSchema });
export const setHandleSchema = z.object({ handle: handleSchema });
export const inviteRequestSchema = z.object({ userId: z.string().min(1).max(200) });

export type FriendEntry = {
  userId: string;
  handle: string;
  name: string;
  online: boolean;
  lastSeenAt: string;
};
export type FriendRequestEntry = { userId: string; handle: string; name: string };
export type InviteEntry = { id: string; tableCode: string; fromName: string; expiresAt: string };

/** One poll for the whole friends panel. Carries no table state. */
export type FriendsResponse = {
  handle: string | null;
  friends: FriendEntry[];
  incoming: FriendRequestEntry[];
  outgoing: FriendRequestEntry[];
  invites: InviteEntry[];
};
```

- [ ] **Step 4: Verify.** Run `pnpm typecheck && pnpm test`. Expected: PASS (PGlite applies the new migration; existing tests unaffected).

---

### Task 2: FriendsService — profiles, handles, presence

**Files:**

- Create: `src/server/friends/service.ts`
- Create: `tests/integration/friends-service.test.ts`

**Interfaces:**

- Consumes: `Db`, `isUniqueViolation` from `@/server/db`; `ServiceError` from `@/server/tables/service`.
- Produces: `type Account = { id: string; name: string }`; `class FriendsService` with `constructor(db: Db, options?: { clock?: () => number })`, `touch(account: Account): Promise<string>` (returns handle), `setHandle(account: Account, handle: string): Promise<string>`. Exports `ONLINE_WINDOW_MS = 75_000`, `INVITE_TTL_MS = 600_000`, `MAX_PENDING_OUT = 30`.

- [ ] **Step 1: Write the failing tests** in `tests/integration/friends-service.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FriendsService, ONLINE_WINDOW_MS, type Account } from "@/server/friends/service";
import { ServiceError } from "@/server/tables/service";

import { createTestDb } from "./db";

const alice: Account = { id: "alice", name: "Alice" };
const bob: Account = { id: "bob", name: "Bob" };
const carol: Account = { id: "carol", name: "Carol" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let now: number;
let friends: FriendsService;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  now = 1_700_000_000_000;
  friends = new FriendsService(db, { clock: () => now });
});

async function rejects(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof ServiceError && e.code === code);
}

describe("profiles and handles", () => {
  it("creates a valid handle on first touch and keeps it", async () => {
    const handle = await friends.touch(alice);
    expect(handle).toMatch(/^[a-z0-9_]{3,20}$/);
    expect(await friends.touch(alice)).toBe(handle);
  });

  it("gives distinct valid handles to same-named and unusable names", async () => {
    const a = await friends.touch({ id: "u1", name: "Sam" });
    const b = await friends.touch({ id: "u2", name: "Sam" });
    const c = await friends.touch({ id: "u3", name: "日本語 !!" });
    expect(new Set([a, b, c]).size).toBe(3);
    for (const h of [a, b, c]) expect(h).toMatch(/^[a-z0-9_]{3,20}$/);
  });

  it("lets a user choose a handle, and rejects one that is taken", async () => {
    await friends.touch(alice);
    await friends.touch(bob);
    expect(await friends.setHandle(alice, "ally")).toBe("ally");
    await rejects(friends.setHandle(bob, "ally"), "bad_request");
    expect(await friends.setHandle(alice, "ally")).toBe("ally");
  });
});

describe("presence", () => {
  it("is online inside the window and offline after it (friends only)", async () => {
    await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    await friends.accept(bob, alice.id);

    now += ONLINE_WINDOW_MS - 1;
    expect((await friends.list(bob.id)).friends[0]).toMatchObject({ userId: "alice", online: true });
    now += 2;
    expect((await friends.list(bob.id)).friends[0]).toMatchObject({ userId: "alice", online: false });
  });
});
```

(The `friends.request/accept/list` calls are implemented in Task 3; the presence test is expected to fail until then — run only the `profiles and handles` block now.)

- [ ] **Step 2: Run to confirm failure.** `pnpm vitest run tests/integration/friends-service.test.ts -t "profiles and handles"` → FAIL (module not found).

- [ ] **Step 3: Implement the service skeleton.** Create `src/server/friends/service.ts`:

```ts
import "server-only";

import { randomInt } from "node:crypto";

import type { FriendsResponse } from "@/lib/protocol";
import { isUniqueViolation, type Db } from "@/server/db";
import { ServiceError } from "@/server/tables/service";

export type Account = { id: string; name: string };

export const ONLINE_WINDOW_MS = 75_000;
export const INVITE_TTL_MS = 10 * 60_000;
export const MAX_PENDING_OUT = 30;
const MAX_HANDLE_ATTEMPTS = 8;

const iso = (ms: number) => new Date(ms).toISOString();
const asIso = (value: Date | string) => new Date(value).toISOString();
const pair = (a: string, b: string) => (a < b ? ([a, b] as const) : ([b, a] as const));

/** `Sam Lee` -> `sam_lee`; names with nothing usable fall back to `player`. */
function handleBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 16);
  return base.length >= 3 ? base : "player";
}

type Options = { clock?: () => number };

export class FriendsService {
  private readonly clock: () => number;

  constructor(
    private readonly db: Db,
    options: Options = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  /** Heartbeat: creates the profile on first use, refreshes the name and `last_seen_at`. Returns the handle. */
  async touch(account: Account): Promise<string> {
    const base = handleBase(account.name);
    for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt++) {
      const handle = attempt === 0 ? base : `${base}${randomInt(100, 10_000)}`;
      try {
        const rows = await this.db.query<{ handle: string }>(
          `INSERT INTO profiles (user_id, handle, display_name, last_seen_at)
           VALUES ($1, $2, $3, $4::timestamptz)
           ON CONFLICT (user_id) DO UPDATE SET display_name = $3, last_seen_at = $4::timestamptz
           RETURNING handle`,
          [account.id, handle, account.name, iso(this.clock())],
        );
        return rows[0]!.handle;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new ServiceError("internal", "Could not allocate a handle");
  }

  async setHandle(account: Account, handle: string): Promise<string> {
    await this.touch(account);
    try {
      await this.db.query(`UPDATE profiles SET handle = $2 WHERE user_id = $1`, [account.id, handle]);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ServiceError("bad_request", "That handle is taken");
      throw error;
    }
    return handle;
  }

  // request, accept, remove, list, invite, dismissInvite, cleanup are added in Tasks 3 and 4.
}
```

Add `// @ts-expect-error` is **not** needed: later tasks append methods; the presence test is skipped until Task 3 (use `describe.skip` is not needed because Step 4 only runs the first block).

- [ ] **Step 4: Run and pass.** `pnpm vitest run tests/integration/friends-service.test.ts -t "profiles and handles"` → PASS. If a `日本語` name collides with `player`, the retry loop must still produce a distinct handle; the test pins that.

- [ ] **Step 5: Checkpoint.** `pnpm lint && pnpm typecheck` → PASS. (The presence block is type-incorrect until Task 3, so typecheck may flag `friends.request`; if it does, comment out that `describe("presence")` block now and restore it at the start of Task 3.)

---

### Task 3: FriendsService — friendships and the poll payload

**Files:**

- Modify: `src/server/friends/service.ts`
- Modify: `tests/integration/friends-service.test.ts`

**Interfaces:**

- Produces on `FriendsService`: `request(account: Account, handle: string): Promise<void>`, `accept(account: Account, otherUserId: string): Promise<void>`, `remove(account: Account, otherUserId: string): Promise<void>`, `list(userId: string): Promise<FriendsResponse>`.

- [ ] **Step 1: Write the failing tests.** Restore the presence block if commented out, and append:

```ts
describe("friendships", () => {
  async function befriend(a: Account, b: Account) {
    await friends.touch(a);
    const handle = await friends.touch(b);
    await friends.request(a, handle);
    await friends.accept(b, a.id);
  }

  it("request -> incoming/outgoing -> accept -> friends on both sides", async () => {
    await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, `@${bobHandle.toUpperCase()} `.trim());

    expect((await friends.list(alice.id)).outgoing).toMatchObject([{ userId: "bob" }]);
    expect((await friends.list(bob.id)).incoming).toMatchObject([{ userId: "alice" }]);
    expect((await friends.list(bob.id)).friends).toEqual([]);

    await friends.accept(bob, alice.id);
    expect((await friends.list(alice.id)).friends).toMatchObject([{ userId: "bob" }]);
    expect((await friends.list(bob.id)).friends).toMatchObject([{ userId: "alice" }]);
    expect((await friends.list(bob.id)).incoming).toEqual([]);
  });

  it("does not show presence to non-friends or pending requests", async () => {
    await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    const incoming = (await friends.list(bob.id)).incoming[0]!;
    expect(incoming).not.toHaveProperty("online");
    expect(incoming).not.toHaveProperty("lastSeenAt");
  });

  it("is idempotent: repeats and crossed requests leave one accepted row", async () => {
    const aliceHandle = await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    await friends.request(alice, bobHandle);
    await friends.request(bob, aliceHandle); // crossed: accepts
    await friends.request(bob, aliceHandle);
    const rows = await db.query(`SELECT status FROM friendships`);
    expect(rows).toEqual([{ status: "accepted" }]);
  });

  it("rejects unknown handles, self requests and accepting your own request", async () => {
    const aliceHandle = await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await rejects(friends.request(alice, "nobody_here"), "not_found");
    await rejects(friends.request(alice, aliceHandle), "bad_request");
    await friends.request(alice, bobHandle);
    await rejects(friends.accept(alice, bob.id), "not_found");
    await rejects(friends.accept(carol, alice.id), "not_found");
  });

  it("caps outgoing pending requests", async () => {
    await friends.touch(alice);
    for (let i = 0; i < 30; i++) {
      const handle = await friends.touch({ id: `p${i}`, name: `Person ${i}` });
      await friends.request(alice, handle);
    }
    const extra = await friends.touch({ id: "extra", name: "Extra" });
    await rejects(friends.request(alice, extra), "rate_limited");
  });

  it("remove deletes the friendship (either side) and is idempotent", async () => {
    await befriend(alice, bob);
    await friends.remove(bob, alice.id);
    await friends.remove(bob, alice.id);
    expect((await friends.list(alice.id)).friends).toEqual([]);
    // can request again afterwards
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    expect((await friends.list(bob.id)).incoming).toMatchObject([{ userId: "alice" }]);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/integration/friends-service.test.ts` → FAIL (methods missing).

- [ ] **Step 3: Implement.** Replace the trailing comment in the class with:

```ts
  async request(account: Account, handle: string): Promise<void> {
    await this.touch(account);
    const targets = await this.db.query<{ user_id: string }>(`SELECT user_id FROM profiles WHERE handle = $1`, [
      handle,
    ]);
    const target = targets[0]?.user_id;
    if (!target) throw new ServiceError("not_found", "No player with that handle");
    if (target === account.id) throw new ServiceError("bad_request", "That's you");

    const [a, b] = pair(account.id, target);
    const existing = await this.db.query<{ status: string; requested_by: string }>(
      `SELECT status, requested_by FROM friendships WHERE user_a = $1 AND user_b = $2`,
      [a, b],
    );
    const row = existing[0];
    if (row) {
      // A request crossing a pending one from the other side means both want it: accept.
      if (row.status === "pending" && row.requested_by !== account.id) {
        await this.db.query(
          `UPDATE friendships SET status = 'accepted' WHERE user_a = $1 AND user_b = $2 AND status = 'pending'`,
          [a, b],
        );
      }
      return;
    }

    const pending = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM friendships WHERE requested_by = $1 AND status = 'pending'`,
      [account.id],
    );
    if (pending[0]!.n >= MAX_PENDING_OUT) {
      throw new ServiceError("rate_limited", "Too many pending requests. Wait for some to be answered.");
    }
    await this.db.query(
      `INSERT INTO friendships (user_a, user_b, requested_by, status) VALUES ($1, $2, $3, 'pending')
       ON CONFLICT DO NOTHING`,
      [a, b, account.id],
    );
  }

  /** Accepts a request that `otherUserId` sent to `account`. */
  async accept(account: Account, otherUserId: string): Promise<void> {
    const [a, b] = pair(account.id, otherUserId);
    const rows = await this.db.query(
      `UPDATE friendships SET status = 'accepted'
        WHERE user_a = $1 AND user_b = $2 AND status = 'pending' AND requested_by <> $3
       RETURNING user_a`,
      [a, b, account.id],
    );
    if (rows.length === 0) throw new ServiceError("not_found", "No request from that player");
  }

  /** Declines, cancels or unfriends. Open invites between the two go with it. Idempotent. */
  async remove(account: Account, otherUserId: string): Promise<void> {
    const [a, b] = pair(account.id, otherUserId);
    await this.db.query(
      `WITH f AS (DELETE FROM friendships WHERE user_a = $1 AND user_b = $2 RETURNING 1)
       DELETE FROM table_invites
        WHERE (from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1)`,
      [a, b],
    );
  }

  async list(userId: string): Promise<FriendsResponse> {
    const now = this.clock();
    type Row = {
      user_id: string;
      handle: string;
      display_name: string;
      last_seen_at: Date | string;
      status: string;
      requested_by: string;
    };
    const [mine, rows, invites] = await Promise.all([
      this.db.query<{ handle: string }>(`SELECT handle FROM profiles WHERE user_id = $1`, [userId]),
      this.db.query<Row>(
        `SELECT p.user_id, p.handle, p.display_name, p.last_seen_at, f.status, f.requested_by
           FROM friendships f
           JOIN profiles p ON p.user_id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
          WHERE f.user_a = $1 OR f.user_b = $1
          ORDER BY lower(p.display_name), p.user_id`,
        [userId],
      ),
      this.db.query<{ id: string; table_code: string; display_name: string; expires_at: Date | string }>(
        `SELECT i.id, i.table_code, p.display_name, i.expires_at
           FROM table_invites i JOIN profiles p ON p.user_id = i.from_user
          WHERE i.to_user = $1 AND i.expires_at > $2::timestamptz
          ORDER BY i.created_at DESC`,
        [userId, iso(now)],
      ),
    ]);

    const response: FriendsResponse = {
      handle: mine[0]?.handle ?? null,
      friends: [],
      incoming: [],
      outgoing: [],
      invites: invites.map((i) => ({
        id: i.id,
        tableCode: i.table_code,
        fromName: i.display_name,
        expiresAt: asIso(i.expires_at),
      })),
    };
    for (const r of rows) {
      const person = { userId: r.user_id, handle: r.handle, name: r.display_name };
      if (r.status === "accepted") {
        const seen = new Date(r.last_seen_at).getTime();
        response.friends.push({
          ...person,
          online: now - seen < ONLINE_WINDOW_MS,
          lastSeenAt: new Date(seen).toISOString(),
        });
      } else if (r.requested_by === userId) {
        response.outgoing.push(person);
      } else {
        response.incoming.push(person);
      }
    }
    return response;
  }
```

- [ ] **Step 4: Run** `pnpm vitest run tests/integration/friends-service.test.ts` → PASS (including the presence block). Note: with the `remove` CTE, Postgres executes the data-modifying CTE `f` even though it is unreferenced.

- [ ] **Step 5: Checkpoint.** `pnpm lint && pnpm typecheck && pnpm vitest run tests/integration/friends-service.test.ts` → PASS.

---

### Task 4: FriendsService — invites and cleanup

**Files:**

- Modify: `src/server/friends/service.ts`
- Modify: `tests/integration/friends-service.test.ts`

**Interfaces:**

- Consumes: `TableService` (tests only) to seat players so `game_players` is mirrored.
- Produces on `FriendsService`: `invite(account: Account, code: string, toUserId: string): Promise<void>`, `dismissInvite(userId: string, inviteId: string): Promise<void>`, `cleanup(): Promise<{ invites: number }>`.

- [ ] **Step 1: Write the failing tests.** Add imports `TableService` from `@/server/tables/service` and `seededRng` from `@/server/engine`, plus at top of the file `const settings = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20 };`. Append:

```ts
describe("invites", () => {
  const host = { playerId: "u_alice", userId: "alice", name: "Alice" };
  const guest = { playerId: "u_bob", userId: "bob", name: "Bob" };
  let tables: TableService;

  async function lobbyWithFriends(): Promise<string> {
    tables = new TableService(db, { clock: () => now, rng: seededRng(3) });
    const { code } = await tables.create(host, settings);
    await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    await friends.accept(bob, alice.id);
    return code;
  }

  it("delivers an invite to a friend and lets them dismiss it", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    const [invite] = (await friends.list(bob.id)).invites;
    expect(invite).toMatchObject({ tableCode: code, fromName: "Alice" });
    expect(Object.keys(invite!).sort()).toEqual(["expiresAt", "fromName", "id", "tableCode"]);
    await friends.dismissInvite(bob.id, invite!.id);
    expect((await friends.list(bob.id)).invites).toEqual([]);
  });

  it("re-inviting refreshes rather than duplicating", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    now += 60_000;
    await friends.invite(alice, code, bob.id);
    expect((await friends.list(bob.id)).invites).toHaveLength(1);
  });

  it("expires after the TTL", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    now += 10 * 60_000 + 1;
    expect((await friends.list(bob.id)).invites).toEqual([]);
    expect(await friends.cleanup()).toEqual({ invites: 1 });
  });

  it("rejects non-friends, unseated senders and non-lobby tables", async () => {
    const code = await lobbyWithFriends();
    await rejects(friends.invite(alice, code, carol.id), "not_found");
    await rejects(friends.invite(bob, code, alice.id), "not_a_player");
    await rejects(friends.invite(alice, "ZZZZZZ", bob.id), "not_a_player");

    await tables.act(code, guest, { type: "join", identity: guest }, -1);
    await tables.act(code, host, { type: "start" }, -1);
    await rejects(friends.invite(alice, code, bob.id), "not_a_player");
  });

  it("removing the friend removes open invites", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    await friends.remove(alice, bob.id);
    expect((await friends.list(bob.id)).invites).toEqual([]);
  });

  it("only the recipient can dismiss an invite", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    const [invite] = (await friends.list(bob.id)).invites;
    await friends.dismissInvite(carol.id, invite!.id);
    expect((await friends.list(bob.id)).invites).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/integration/friends-service.test.ts -t invites` → FAIL.

- [ ] **Step 3: Implement.** Append to the class:

```ts
  /** Invite an accepted friend to a lobby you are seated in. Re-inviting refreshes the invite. */
  async invite(account: Account, code: string, toUserId: string): Promise<void> {
    await this.touch(account);
    const seated = await this.db.query(
      `SELECT 1 FROM games g JOIN game_players gp ON gp.game_id = g.id
        WHERE g.code = $1 AND g.status = 'lobby' AND gp.user_id = $2`,
      [code, account.id],
    );
    if (seated.length === 0) throw new ServiceError("not_a_player", "You are not seated at that lobby");

    const [a, b] = pair(account.id, toUserId);
    const friend = await this.db.query(
      `SELECT 1 FROM friendships WHERE user_a = $1 AND user_b = $2 AND status = 'accepted'`,
      [a, b],
    );
    if (friend.length === 0) throw new ServiceError("not_found", "That player isn't your friend");

    const now = this.clock();
    await this.db.query(
      `INSERT INTO table_invites (table_code, from_user, to_user, created_at, expires_at)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       ON CONFLICT (table_code, to_user)
       DO UPDATE SET from_user = $2, created_at = $4::timestamptz, expires_at = $5::timestamptz`,
      [code, account.id, toUserId, iso(now), iso(now + INVITE_TTL_MS)],
    );
  }

  async dismissInvite(userId: string, inviteId: string): Promise<void> {
    await this.db.query(`DELETE FROM table_invites WHERE id = $1 AND to_user = $2`, [inviteId, userId]);
  }

  /** Daily sweep: expired invites are already hidden on read, this just frees the rows. */
  async cleanup(): Promise<{ invites: number }> {
    const rows = await this.db.query(
      `DELETE FROM table_invites WHERE expires_at <= $1::timestamptz RETURNING id`,
      [iso(this.clock())],
    );
    return { invites: rows.length };
  }
```

`dismissInvite` with a non-UUID id would make Postgres raise `invalid input syntax for type uuid`; the route (Task 5) validates the id with `z.uuid()` first.

- [ ] **Step 4: Run** `pnpm vitest run tests/integration/friends-service.test.ts` → PASS. In the "expires" test, `cleanup()` uses the same clock, so the 1 expired row is deleted.

- [ ] **Step 5: Checkpoint.** `pnpm lint && pnpm typecheck && pnpm test` → PASS.

---

### Task 5: Routes and wiring

**Files:**

- Create: `src/server/friends/index.ts`
- Create: `src/app/api/friends/route.ts`, `src/app/api/friends/requests/route.ts`, `src/app/api/friends/[userId]/route.ts`, `src/app/api/friends/invites/[id]/route.ts`
- Create: `src/app/api/me/presence/route.ts`, `src/app/api/me/handle/route.ts`
- Create: `src/app/api/tables/[code]/invites/route.ts`
- Modify: `src/app/api/cron/cleanup/route.ts`

**Interfaces:**

- Consumes: `FriendsService` (Tasks 2-4); `route`, `readJson`, `tableCode` from `@/server/http`; `getAccountUser` from `@/server/auth`; `friendRequestSchema`, `setHandleSchema`, `inviteRequestSchema`, `FriendsResponse` from `@/lib/protocol`.
- Produces: `getFriendsService(): Promise<FriendsService>`, `requireAccount(): Promise<Account>`; HTTP surface listed in the spec.

- [ ] **Step 1: Create `src/server/friends/index.ts`:**

```ts
import "server-only";

import { getAccountUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { ServiceError } from "@/server/tables";

import { FriendsService, type Account } from "./service";

export * from "./service";

let service: Promise<FriendsService> | undefined;

export function getFriendsService(): Promise<FriendsService> {
  service ??= getDb().then((db) => new FriendsService(db));
  return service;
}

/** Friends are for signed-in accounts. Guests, and deployments without accounts, get a 401. */
export async function requireAccount(): Promise<Account> {
  const user = await getAccountUser();
  if (!user) throw new ServiceError("unauthorized", "Sign in to use friends");
  return { id: user.id, name: user.name };
}
```

- [ ] **Step 2: Create the routes.** Each follows the pattern of `join/route.ts`.

`src/app/api/friends/route.ts`:

```ts
import { NextResponse } from "next/server";

import type { FriendsResponse } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

export const GET = route(async () => {
  const account = await requireAccount();
  return NextResponse.json<FriendsResponse>(await (await getFriendsService()).list(account.id));
});
```

`src/app/api/friends/requests/route.ts`:

```ts
import { NextResponse } from "next/server";

import { friendRequestSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const POST = route(async (request) => {
  const account = await requireAccount();
  const { handle } = await readJson(request, friendRequestSchema);
  await (await getFriendsService()).request(account, handle);
  return NextResponse.json({ ok: true });
});
```

`src/app/api/friends/[userId]/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

type Context = { params: Promise<{ userId: string }> };

/** Accept a request from `userId`. */
export const PATCH = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const { userId } = await context.params;
  await (await getFriendsService()).accept(account, userId);
  return NextResponse.json({ ok: true });
});

/** Decline, cancel or unfriend. */
export const DELETE = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const { userId } = await context.params;
  await (await getFriendsService()).remove(account, userId);
  return NextResponse.json({ ok: true });
});
```

`src/app/api/friends/invites/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export const DELETE = route(async (_request, context: Context) => {
  const account = await requireAccount();
  const id = z.uuid().parse((await context.params).id);
  await (await getFriendsService()).dismissInvite(account.id, id);
  return NextResponse.json({ ok: true });
});
```

`src/app/api/me/presence/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getFriendsService, requireAccount } from "@/server/friends";
import { route } from "@/server/http";

export const PUT = route(async () => {
  const account = await requireAccount();
  const handle = await (await getFriendsService()).touch(account);
  return NextResponse.json({ handle });
});
```

`src/app/api/me/handle/route.ts`:

```ts
import { NextResponse } from "next/server";

import { setHandleSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route } from "@/server/http";

export const PUT = route(async (request) => {
  const account = await requireAccount();
  const { handle } = await readJson(request, setHandleSchema);
  return NextResponse.json({ handle: await (await getFriendsService()).setHandle(account, handle) });
});
```

`src/app/api/tables/[code]/invites/route.ts`:

```ts
import { NextResponse } from "next/server";

import { inviteRequestSchema } from "@/lib/protocol";
import { getFriendsService, requireAccount } from "@/server/friends";
import { readJson, route, tableCode } from "@/server/http";

type Context = { params: Promise<{ code: string }> };

/** Invite a friend to a lobby you are seated in. Returns nothing about the table. */
export const POST = route(async (request, context: Context) => {
  const code = await tableCode(context);
  const account = await requireAccount();
  const { userId } = await readJson(request, inviteRequestSchema);
  await (await getFriendsService()).invite(account, code, userId);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 3: Sweep invites in the cron.** In `src/app/api/cron/cleanup/route.ts` import `getFriendsService` from `@/server/friends` and return both results:

```ts
const db = await getDb();
const [tables, invites] = await Promise.all([
  cleanupTables(db, Date.now()),
  (await getFriendsService()).cleanup(),
]);
return NextResponse.json({ ...tables, ...invites });
```

- [ ] **Step 4: Route-level test for the guest 401.** Create `tests/integration/friends-routes.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET } from "@/app/api/friends/route";

describe("friends routes", () => {
  it("answers 401 to guests and when accounts are off", async () => {
    const response = await GET(new Request("http://x/api/friends"), { params: Promise.resolve({}) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});
```

Run `pnpm vitest run tests/integration/friends-routes.test.ts` → PASS. If importing the route pulls `next/headers` and fails in node, mock it too (`vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))`).

- [ ] **Step 5: Checkpoint.** `pnpm lint && pnpm typecheck && pnpm test` → PASS. Do not run `next build` against production env.

---

### Task 6: Client API and hooks

**Files:**

- Modify: `src/lib/client/api.ts`
- Create: `src/lib/client/use-friends.ts`
- Create: `src/components/PresenceBeat.tsx`
- Modify: `src/app/layout.tsx`
- Create: `src/lib/client/use-friends.test.tsx`

**Interfaces:**

- Produces: `api.friends()`, `api.sendFriendRequest(handle)`, `api.acceptFriend(userId)`, `api.removeFriend(userId)`, `api.setHandle(handle)`, `api.heartbeat()`, `api.inviteFriend(code, userId)`, `api.dismissInvite(id)`; `useFriends(): { data: FriendsResponse | null; error: string | null; refresh(): Promise<void> }`; `usePresence(): void`; `<PresenceBeat />`.

- [ ] **Step 1: Add API methods.** In `api.ts` add `FriendsResponse` to the type import, a helper next to `post`:

```ts
const send = <T>(method: "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
```

and inside `api`:

```ts
  friends: () => request<FriendsResponse>("/api/friends"),
  sendFriendRequest: (handle: string) => post<{ ok: true }>("/api/friends/requests", { handle }),
  acceptFriend: (userId: string) => send<{ ok: true }>("PATCH", `/api/friends/${encodeURIComponent(userId)}`),
  removeFriend: (userId: string) => send<{ ok: true }>("DELETE", `/api/friends/${encodeURIComponent(userId)}`),
  dismissInvite: (id: string) => send<{ ok: true }>("DELETE", `/api/friends/invites/${encodeURIComponent(id)}`),
  setHandle: (handle: string) => send<{ handle: string }>("PUT", "/api/me/handle", { handle }),
  heartbeat: () => send<{ handle: string }>("PUT", "/api/me/presence"),
  inviteFriend: (code: string, userId: string) =>
    post<{ ok: true }>(`/api/tables/${encodeURIComponent(code)}/invites`, { userId }),
```

Note `request` only sets the JSON content-type header when `init.body` is set, which `send` respects.

- [ ] **Step 2: Write the failing hook test** `src/lib/client/use-friends.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FriendsResponse } from "@/lib/protocol";

import { api, ApiError } from "./api";
import { usePresence, useFriends } from "./use-friends";
import * as meModule from "./use-me";

const empty: FriendsResponse = { handle: "al", friends: [], incoming: [], outgoing: [], invites: [] };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "u", name: "U", email: null, image: null },
  } as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useFriends", () => {
  it("polls every 5 seconds", async () => {
    const spy = vi.spyOn(api, "friends").mockResolvedValue(empty);
    const { result } = renderHook(() => useFriends());
    await waitFor(() => expect(result.current.data).toEqual(empty));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("does not poll without an account", async () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null } as never);
    const spy = vi.spyOn(api, "friends").mockResolvedValue(empty);
    renderHook(() => useFriends());
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the last data and reports the error when a poll fails", async () => {
    const spy = vi
      .spyOn(api, "friends")
      .mockResolvedValueOnce(empty)
      .mockRejectedValue(new ApiError("network", "offline", 0));
    const { result } = renderHook(() => useFriends());
    await waitFor(() => expect(result.current.data).toEqual(empty));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(empty);
    expect(result.current.error).toBe("offline");
  });
});

describe("usePresence", () => {
  it("beats immediately and every 30 seconds while visible", async () => {
    const spy = vi.spyOn(api, "heartbeat").mockResolvedValue({ handle: "al" });
    renderHook(() => usePresence());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
```

Confirm how `useMe` returns its value (read the end of `use-me.ts`: it returns `me` or a loading shape); adjust the mock shape to match before running. Run `pnpm vitest run src/lib/client/use-friends.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/client/use-friends.ts`:**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

import type { FriendsResponse } from "@/lib/protocol";

import { api } from "./api";
import { useMe } from "./use-me";

const POLL_MS = 5_000;
const BEAT_MS = 30_000;

/** The friends panel's data. Polls only for signed-in accounts and keeps the last good payload on errors. */
export function useFriends() {
  const me = useMe();
  const signedIn = Boolean(me?.user);
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api.friends());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [signedIn, refresh]);

  return { data, error, refresh };
}

/** Tells the server this account is here. Mounted once in the layout so it also runs during a game. */
export function usePresence() {
  const me = useMe();
  const signedIn = Boolean(me?.user);
  useEffect(() => {
    if (!signedIn) return;
    const beat = () => {
      if (document.visibilityState === "visible") api.heartbeat().catch(() => {});
    };
    beat();
    const id = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [signedIn]);
}
```

If `useMe()` returns something other than `MeResponse | null` (check the file's return), adapt `signedIn` accordingly.

- [ ] **Step 4: Create `src/components/PresenceBeat.tsx` and mount it:**

```tsx
"use client";

import { usePresence } from "@/lib/client/use-friends";

export function PresenceBeat() {
  usePresence();
  return null;
}
```

In `src/app/layout.tsx`, import it and render `<PresenceBeat />` right after `<SiteHeader />`.

- [ ] **Step 5: Run** `pnpm vitest run src/lib/client/use-friends.test.tsx` → PASS, then `pnpm lint && pnpm typecheck`.

---

### Task 7: UI — friends panel, lobby invites, styles

**Files:**

- Create: `src/components/FriendsPanel.tsx`, `src/components/InviteFriends.tsx`, `src/components/FriendsPanel.test.tsx`
- Modify: `src/app/page.tsx`, `src/components/Lobby.tsx`, `src/app/globals.css`

**Interfaces:**

- Consumes: `useFriends`, `useMe`, `api` (Task 6); `FriendsResponse` types.
- Produces: `<FriendsPanel />` (no props), `<InviteFriends code={string} />`.

- [ ] **Step 1: Write the failing component test** `src/components/FriendsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse } from "@/lib/protocol";

import { FriendsPanel } from "./FriendsPanel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const payload: FriendsResponse = {
  handle: "alice",
  friends: [
    { userId: "b", handle: "bob", name: "Bob", online: true, lastSeenAt: new Date().toISOString() },
    {
      userId: "c",
      handle: "carol",
      name: "Carol",
      online: false,
      lastSeenAt: new Date(Date.now() - 3_600_000).toISOString(),
    },
  ],
  incoming: [{ userId: "d", handle: "dave", name: "Dave" }],
  outgoing: [],
  invites: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      tableCode: "ABC234",
      fromName: "Bob",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  ],
};

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  } as never);
  vi.spyOn(api, "friends").mockResolvedValue(payload);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FriendsPanel", () => {
  it("shows online friends first with a status, plus requests and invites", async () => {
    render(<FriendsPanel />);
    const bob = await screen.findByRole("listitem", { name: /Bob/ });
    expect(bob).toHaveTextContent(/online/i);
    expect(screen.getByRole("listitem", { name: /Carol/ })).toHaveTextContent(/last seen/i);
    expect(screen.getByText(/Dave/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join ABC234/ })).toHaveAttribute("href", "/table/ABC234");
  });

  it("sends a request by handle and shows a server error", async () => {
    const send = vi
      .spyOn(api, "sendFriendRequest")
      .mockRejectedValueOnce(new Error("No player with that handle"));
    render(<FriendsPanel />);
    await userEvent.type(await screen.findByLabelText(/friend's handle/i), "@Nobody");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(send).toHaveBeenCalledWith("@Nobody");
    expect(await screen.findByRole("alert")).toHaveTextContent("No player with that handle");
  });

  it("accepts a request", async () => {
    const accept = vi.spyOn(api, "acceptFriend").mockResolvedValue({ ok: true });
    render(<FriendsPanel />);
    await userEvent.click(await screen.findByRole("button", { name: /Accept Dave/ }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith("d"));
  });

  it("renders nothing for guests", () => {
    vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null } as never);
    const { container } = render(<FriendsPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

Check that `@testing-library/user-event` is in `package.json`; if not, use `fireEvent` from `@testing-library/react` instead (no new dependency without asking the user).

- [ ] **Step 2: Run** `pnpm vitest run src/components/FriendsPanel.test.tsx` → FAIL.

- [ ] **Step 3: Implement `FriendsPanel.tsx`.** Requirements the test pins: renders `null` unless signed in; `<ul aria-label="Friends">` with one `<li aria-label={name}>` per friend, online first then by name, text `Online` or `Last seen <relative>`; incoming requests with `Accept <name>` and `Decline <name>` buttons; outgoing with `Cancel`; invites as `<Link href={`/table/${tableCode}`}>Join {tableCode}</Link>` with "from {fromName}" and a Dismiss button; a form with `<label htmlFor>` "Add a friend's handle", input, and `Send request` button; errors in `<p role="alert">`. Skeleton:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";
import { useMe } from "@/lib/client/use-me";

function lastSeen(iso: string) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `Last seen ${hours} h ago` : `Last seen ${Math.round(hours / 24)} d ago`;
}

export function FriendsPanel() {
  const me = useMe();
  const { data, error, refresh } = useFriends();
  const [handle, setHandle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  if (!me?.user || !data) return null;

  async function run(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  const friends = [...data.friends].sort(
    (a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name),
  );
  const shown = actionError ?? error;

  return (
    <section className="friends" aria-labelledby="friends-title">
      <h2 id="friends-title">Friends</h2>
      <p className="friends-handle">
        Your handle: <strong>@{data.handle}</strong>
      </p>

      {data.invites.length > 0 && (
        <ul className="friends-list" aria-label="Table invites">
          {data.invites.map((i) => (
            <li key={i.id}>
              <span>{i.fromName} invited you</span>
              <Link className="button" href={`/table/${i.tableCode}`}>
                Join {i.tableCode}
              </Link>
              <button
                type="button"
                className="button-quiet"
                onClick={() => run(() => api.dismissInvite(i.id))}
              >
                Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}

      {data.incoming.length > 0 && (
        <ul className="friends-list" aria-label="Friend requests">
          {data.incoming.map((r) => (
            <li key={r.userId}>
              <span>
                {r.name} <small>@{r.handle}</small>
              </span>
              <button
                type="button"
                className="button"
                aria-label={`Accept ${r.name}`}
                onClick={() => run(() => api.acceptFriend(r.userId))}
              >
                Accept
              </button>
              <button
                type="button"
                className="button-quiet"
                aria-label={`Decline ${r.name}`}
                onClick={() => run(() => api.removeFriend(r.userId))}
              >
                Decline
              </button>
            </li>
          ))}
        </ul>
      )}

      <ul className="friends-list" aria-label="Friends">
        {friends.map((f) => (
          <li key={f.userId} aria-label={f.name} data-online={f.online}>
            <span className="presence-dot" aria-hidden />
            <span>
              {f.name} <small>@{f.handle}</small>
            </span>
            <small>{f.online ? "Online" : lastSeen(f.lastSeenAt)}</small>
            <button
              type="button"
              className="button-quiet"
              aria-label={`Remove ${f.name}`}
              onClick={() => run(() => api.removeFriend(f.userId))}
            >
              Remove
            </button>
          </li>
        ))}
        {friends.length === 0 && (
          <li className="friends-empty">No friends yet. Share your handle or add one below.</li>
        )}
      </ul>

      {data.outgoing.length > 0 && (
        <p className="friends-pending">Waiting on {data.outgoing.map((r) => `@${r.handle}`).join(", ")}</p>
      )}

      <form
        className="friends-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!handle.trim()) return;
          void run(async () => {
            await api.sendFriendRequest(handle);
            setHandle("");
          });
        }}
      >
        <label htmlFor="friend-handle">Add a friend&apos;s handle</label>
        <input
          id="friend-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="@handle"
        />
        <button type="submit" className="button" disabled={!handle.trim()}>
          Send request
        </button>
      </form>
      {shown && (
        <p role="alert" className="friends-error">
          {shown}
        </p>
      )}
    </section>
  );
}
```

In the "Carol" test the `aria-label` on `<li>` overrides content for name matching: the `findByRole("listitem", { name: /Bob/ })` works, and `toHaveTextContent` reads real content, so both pass. In the error test, the poll error and action error share the one alert.

- [ ] **Step 4: Implement `InviteFriends.tsx`** (lobby picker for signed-in seated players). Uses `useFriends`; lists online friends only, each with an `Invite <name>` button calling `api.inviteFriend(code, userId)`, then shows "Invited" for that user for the session; hides itself if signed out or no friends are online:

```tsx
"use client";

import { useState } from "react";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";

export function InviteFriends({ code }: { code: string }) {
  const { data } = useFriends();
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const online = data?.friends.filter((f) => f.online) ?? [];
  if (online.length === 0) return null;

  async function invite(userId: string) {
    setError(null);
    try {
      await api.inviteFriend(code, userId);
      setInvited((prev) => new Set(prev).add(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <section className="invite-friends" aria-label="Invite friends">
      <h3>Invite a friend</h3>
      <ul>
        {online.map((f) => (
          <li key={f.userId}>
            <span className="presence-dot" aria-hidden /> {f.name}
            <button
              type="button"
              className="button-quiet"
              disabled={invited.has(f.userId)}
              onClick={() => invite(f.userId)}
            >
              {invited.has(f.userId) ? "Invited" : `Invite ${f.name}`}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 5: Wire in.**
  - `src/app/page.tsx`: import `FriendsPanel` and render `<FriendsPanel />` directly after the `home-forms` div (inside `<main>`).
  - `src/components/Lobby.tsx`: import `InviteFriends`; render `{isPlayer && <InviteFriends code={view.code} />}` below the `lobby-players` list. The component is self-hiding for guests, since `useFriends` does nothing without an account and `data` stays null.

- [ ] **Step 6: Styles.** Append to `src/app/globals.css`, using only existing variables, and check both themes:

```css
.friends {
  display: grid;
  gap: 0.75rem;
  max-width: 40rem;
}

.friends-handle,
.friends-pending,
.friends-empty {
  color: var(--ink-soft);
}

.friends-list,
.invite-friends ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.5rem;
}

.friends-list li,
.invite-friends li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  border-radius: var(--radius-control);
  background: var(--card);
  border: 1px solid var(--line);
}

.presence-dot {
  inline-size: 0.625rem;
  block-size: 0.625rem;
  border-radius: 50%;
  background: var(--line);
  flex: none;
}

[data-online="true"] > .presence-dot {
  background: #1f9d55;
}

.friends-add {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.5rem;
}

.friends-error {
  color: var(--danger);
}
```

The presence dot is decorative (`aria-hidden`); the "Online / Last seen" text carries the meaning, so colour is not the only signal.

- [ ] **Step 7: Run** `pnpm vitest run src/components/FriendsPanel.test.tsx` → PASS, then `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`. Run `pnpm format` if only formatting fails.

---

### Task 8: Review, docs, verification

**Files:**

- Modify: `README.md`, `CLAUDE.md` (only facts that changed)

- [ ] **Step 1: Anti-cheat review.** Run the `anti-cheat-reviewer` agent on the diff. Expected: no face-down tile leaks (invites and the friends payload carry no table state), no server-only imports in client code, no `table_state` reads in friends code. Fix anything it reports.

- [ ] **Step 2: Docs.** Run the `sync-docs` skill. At minimum: the Map in `CLAUDE.md` gains `src/server/friends/service.ts` (`FriendsService`: profiles, presence, friendships, invites; reads only public tables), and `README.md` documents the heartbeat/poll model, the 75s online window, the `@handle` lookup, and that friends are signed-in only.

- [ ] **Step 3: Verify.** Run the `verify` skill (`pnpm lint` → `pnpm format:check` → `pnpm typecheck` → `pnpm test`); fix failures.

- [ ] **Step 4: Manual check (local, PGlite only).** With `DATABASE_URL=pglite:./.pglite` and the `NEON_AUTH_*` variables empty, the feature is hidden (guest mode); confirm the home page and lobby render with no friends UI and no console errors. Full two-account flow needs Neon Auth and is left to the user, or to E2E when requested.

- [ ] **Step 5: Report.** List what is ready to commit (migration, service, routes, client, UI, docs, spec and plan). Note that the migration must be applied by the user (`pnpm db:migrate:local` for production, `pnpm test:e2e:neon` for the e2e branch), which this plan never runs.

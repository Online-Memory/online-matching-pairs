# Friends, presence and table invites: design

Date: 2026-10-05. Status: awaiting review.

## Goal

Signed-in players keep a friends list, see which friends are online, and invite friends to their table.
Success: A adds B by handle, B accepts, and each sees the other's online state within a couple of polls.
A's invite to a table appears in B's friends poll and B joins through the existing join flow.

## Decisions (agreed with the user)

- Friendship is mutual: request, then accept.
- Players are found by a new unique `@handle`, matched exactly. No email or display-name search.
- Presence is visible only to accepted friends.
- v1 scope is online/offline with last seen, plus invites to a table. No "in a game" status, chat, blocking or push.
- Guests and auth-disabled mode (`NEON_AUTH_*` unset) get none of this; the UI is hidden and the routes return 401/404.
- Presence uses a heartbeat into Postgres and polling, not SSE/WebSocket. Serverless means no in-memory presence.

## Data: one additive migration

New file in `db/migrations/` via the `new-migration` skill. It only adds tables, so the old deployment keeps working.

- `profiles(user_id text PRIMARY KEY, handle text NOT NULL, display_name text NOT NULL, last_seen_at timestamptz NOT NULL)`
  with a unique index on `lower(handle)`. Handle format: 3-20 chars, `[a-z0-9_]`. A profile row is created lazily on the
  first heartbeat or handle set, with a suggested handle derived from the account name and de-duplicated.
- `friendships(user_a text, user_b text, requested_by text, status text CHECK (status IN ('pending','accepted')), created_at timestamptz, PRIMARY KEY (user_a, user_b), CHECK (user_a < user_b))`.
  One row per pair, so duplicates and cross-requests collapse into one row. A request from B to A while A's request to B
  is pending accepts it.
- `table_invites(id uuid PRIMARY KEY, table_code text, from_user text, to_user text, created_at timestamptz, expires_at timestamptz)`
  with an index on `(to_user, expires_at)`. Invites live 10 minutes.

## Server

- `src/server/friends/service.ts`: `FriendsService`, shaped like `TableService`. It imports `server-only`, takes the DB
  and a clock, and has no `Date.now()`; `now` is injected so tests control time. Writes are single statements, with no
  interactive transactions.
- Presence: `touch(userId, now)` upserts `last_seen_at`. A friend is online when `now - last_seen_at < 75s`.
- Handle lookup is exact and rate-limited per user, to stop enumeration. Errors for "no such handle" and "already
  friends" look the same to the caller where that avoids leaking account existence.
- Invites: the sender must be seated at the table (checked against the table's players through `TableService`), the
  recipient must be an accepted friend, and there is at most one open invite per (table, recipient).
  Expired invites are filtered on read.

### Routes (thin wrappers, `route()` helper from `src/server/http.ts`)

| Route                                        | Purpose                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/friends`                           | One poll payload: friends (handle, name, online, lastSeenAt), incoming and outgoing requests, open invites |
| `POST /api/friends/requests` `{handle}`      | Send a request                                                                                             |
| `PATCH /api/friends/[userId]`                | Accept a request                                                                                           |
| `DELETE /api/friends/[userId]`               | Decline, cancel or remove                                                                                  |
| `PUT /api/me/presence`                       | Heartbeat                                                                                                  |
| `PUT /api/me/handle`                         | Set the handle                                                                                             |
| `POST /api/tables/[code]/invites` `{userId}` | Invite a friend to a seated table                                                                          |
| `DELETE /api/friends/invites/[id]`           | Dismiss an invite                                                                                          |

Response types are added to `src/lib/protocol/` and contain no table state. An invite carries only `tableCode`, the
sender's name and expiry, so `toView` and the face-down-tile invariant are not involved.

## Client

- `src/lib/client/use-friends.ts`: polls `GET /api/friends` every ~5s and sends the heartbeat every ~30s while
  `document.visibilityState === "visible"`. Does nothing when `useMe` shows no account.
- `FriendsPanel` on the home page (`Lobby`): friends with a status dot, requests with accept/decline, an add-by-handle
  field, and invites with a Join button that navigates to the table's existing join path.
- A friends picker on `TableScreen` for seated signed-in players, which posts an invite.
- A handle prompt on first use of the panel.

## Testing

- Vitest integration tests on in-memory PGlite for `FriendsService`: request/accept, duplicate and reverse requests,
  self-friend rejected, handle uniqueness and case, presence threshold with an injected clock, invite authorization
  (non-seated sender, non-friend recipient, expired invite), and that presence is hidden from non-friends.
- Route tests for 401 as guest and for auth disabled.
- Component tests for `FriendsPanel` and `use-friends`.
- E2E only on request.
- Run `anti-cheat-reviewer`, because the diff touches `src/app/api/tables/` and `src/lib/protocol/`.
- Run `verify` before reporting done.

## Out of scope (v1)

Blocking and reporting, chat, "in a game" status, push or SSE, email invites, guest accounts.

## Open risks

- Polling cost: one cheap indexed query per signed-in tab every 5s. Acceptable at the current scale; revisit if load
  grows.
- Cleanup: expired invites and long-idle pending requests need a sweep, which can go in the existing `src/app/api/cron`.

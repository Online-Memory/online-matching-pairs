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

/** What the friends feature needs to know about tables. `TableService` implements it. */
export interface Seating {
  isSeatedInLobby(code: string, userId: string): Promise<boolean>;
}

type Options = { clock?: () => number; seating: Seating };

export class FriendsService {
  private readonly clock: () => number;
  private readonly seating: Seating;

  constructor(
    private readonly db: Db,
    options: Options,
  ) {
    this.clock = options.clock ?? Date.now;
    this.seating = options.seating;
  }

  /**
   * Heartbeat: creates the profile on first use, refreshes the name and `last_seen_at`. Returns the handle.
   * `tableCode` is the table the player is seated at (null: none); leave it out to keep what they last reported.
   */
  async touch(account: Account, tableCode?: string | null): Promise<string> {
    const base = handleBase(account.name);
    for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt++) {
      const handle = attempt === 0 ? base : `${base}${randomInt(100, 10_000)}`;
      try {
        const rows = await this.db.query<{ handle: string }>(
          `INSERT INTO profiles (user_id, handle, display_name, last_seen_at, current_table_code)
           VALUES ($1, $2, $3, $4::timestamptz, $5::text)
           ON CONFLICT (user_id) DO UPDATE
              SET display_name = $3, last_seen_at = $4::timestamptz,
                  current_table_code = CASE WHEN $6::boolean THEN $5::text ELSE profiles.current_table_code END
           RETURNING handle`,
          [account.id, handle, account.name, iso(this.clock()), tableCode ?? null, tableCode !== undefined],
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

  /** `handle` is already canonical (the route runs it through `handleSchema`). */
  async request(account: Account, handle: string): Promise<void> {
    await this.touch(account);
    // Checked before the lookup so a capped caller can't keep probing which handles exist.
    const pending = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM friendships WHERE requested_by = $1 AND status = 'pending'`,
      [account.id],
    );
    if (pending[0]!.n >= MAX_PENDING_OUT) {
      throw new ServiceError("rate_limited", "Too many pending requests. Wait for some to be answered.");
    }
    const targets = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM profiles WHERE handle = $1`,
      [handle],
    );
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

  /** What the friends panel polls: makes sure the profile exists (new accounts get a handle at once), then lists. */
  async overview(account: Account): Promise<FriendsResponse> {
    await this.touch(account);
    return this.list(account.id);
  }

  async list(userId: string): Promise<FriendsResponse> {
    const now = this.clock();
    type Row = {
      user_id: string;
      handle: string;
      display_name: string;
      last_seen_at: Date | string;
      current_table_code: string | null;
      status: string;
      requested_by: string;
    };
    const [mine, rows, invites] = await Promise.all([
      this.db.query<{ handle: string }>(`SELECT handle FROM profiles WHERE user_id = $1`, [userId]),
      this.db.query<Row>(
        `SELECT p.user_id, p.handle, p.display_name, p.last_seen_at, p.current_table_code, f.status, f.requested_by
           FROM friendships f
           JOIN profiles p ON p.user_id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
          WHERE f.user_a = $1 OR f.user_b = $1
          ORDER BY lower(p.display_name), p.user_id`,
        [userId],
      ),
      this.db.query<{
        id: string;
        table_code: string;
        display_name: string;
        handle: string;
        expires_at: Date | string;
      }>(
        `SELECT i.id, i.table_code, p.display_name, p.handle, i.expires_at
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
        fromHandle: i.handle,
        expiresAt: asIso(i.expires_at),
      })),
    };
    for (const r of rows) {
      const person = { userId: r.user_id, handle: r.handle, name: r.display_name };
      if (r.status === "accepted") {
        const seen = new Date(r.last_seen_at).getTime();
        const online = now - seen < ONLINE_WINDOW_MS;
        response.friends.push({
          ...person,
          online,
          inGame: online && r.current_table_code !== null,
          lastSeenAt: new Date(seen).toISOString(),
        });
      } else if (r.requested_by === userId) {
        response.outgoing.push({ userId: r.user_id, handle: r.handle });
      } else {
        response.incoming.push(person);
      }
    }
    return response;
  }

  /** Ids of accepted friends, for features (leaderboards) that need the set but not the details. */
  async friendIds(userId: string): Promise<string[]> {
    const rows = await this.db.query<{ friend: string }>(
      `SELECT CASE WHEN user_a = $1 THEN user_b ELSE user_a END AS friend
         FROM friendships
        WHERE status = 'accepted' AND (user_a = $1 OR user_b = $1)`,
      [userId],
    );
    return rows.map((r) => r.friend);
  }

  /** Invite an accepted friend to a lobby you are seated in. Re-inviting refreshes the invite. */
  async invite(account: Account, code: string, toUserId: string): Promise<void> {
    await this.touch(account);
    const seated = await this.seating.isSeatedInLobby(code, account.id);
    if (!seated) throw new ServiceError("not_a_player", "You are not seated at that lobby");

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

  /** The invitee took the seat, so the invite has done its job. Idempotent. */
  async clearInvitesForTable(userId: string, code: string): Promise<void> {
    await this.db.query(`DELETE FROM table_invites WHERE to_user = $1 AND table_code = $2`, [userId, code]);
  }

  /** Daily sweep: expired invites are already hidden on read, this just frees the rows. */
  async cleanup(): Promise<{ invites: number }> {
    const rows = await this.db.query(
      `DELETE FROM table_invites WHERE expires_at <= $1::timestamptz RETURNING id`,
      [iso(this.clock())],
    );
    return { invites: rows.length };
  }
}

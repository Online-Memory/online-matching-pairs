import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seededRng } from "@/server/engine";
import { FriendsService, ONLINE_WINDOW_MS, type Account } from "@/server/friends/service";
import { ServiceError, TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const settings = {
  theme: "001",
  pairs: 8,
  maxPlayers: 4,
  turnSeconds: 20,
  isPublic: false,
  tableName: "Test table",
};
const alice: Account = { id: "alice", name: "Alice" };
const bob: Account = { id: "bob", name: "Bob" };
const carol: Account = { id: "carol", name: "Carol" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let now: number;
let friends: FriendsService;
let tables: TableService;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  now = 1_700_000_000_000;
  tables = new TableService(db, { clock: () => now, rng: seededRng(3) });
  friends = new FriendsService(db, { clock: () => now, seating: tables });
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
    const d = await friends.touch({ id: "u4", name: "!!" });
    expect(new Set([a, b, c, d]).size).toBe(4);
    for (const h of [a, b, c, d]) expect(h).toMatch(/^[a-z0-9_]{3,20}$/);
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

describe("overview", () => {
  it("creates the profile so a brand-new account sees its handle straight away", async () => {
    const overview = await friends.overview(alice);
    expect(overview.handle).toMatch(/^[a-z0-9_]{3,20}$/);
  });
});

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
    await friends.request(alice, bobHandle);

    expect((await friends.list(alice.id)).outgoing).toMatchObject([{ userId: "bob" }]);
    expect((await friends.list(bob.id)).incoming).toMatchObject([{ userId: "alice" }]);
    expect((await friends.list(bob.id)).friends).toEqual([]);

    await friends.accept(bob, alice.id);
    expect((await friends.list(alice.id)).friends).toMatchObject([{ userId: "bob" }]);
    expect((await friends.list(bob.id)).friends).toMatchObject([{ userId: "alice" }]);
    expect((await friends.list(bob.id)).incoming).toEqual([]);
  });

  it("does not show presence on pending requests", async () => {
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
    // Capped callers learn nothing about which handles exist.
    await rejects(friends.request(alice, "nobody_here"), "rate_limited");
  });

  it("does not hand the target's display name to someone who merely requested them", async () => {
    await friends.touch(alice);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    expect((await friends.list(alice.id)).outgoing).toEqual([{ userId: "bob", handle: bobHandle }]);
  });

  it("remove deletes the friendship from either side and is idempotent", async () => {
    await befriend(alice, bob);
    await friends.remove(bob, alice.id);
    await friends.remove(bob, alice.id);
    expect((await friends.list(alice.id)).friends).toEqual([]);
    const bobHandle = await friends.touch(bob);
    await friends.request(alice, bobHandle);
    expect((await friends.list(bob.id)).incoming).toMatchObject([{ userId: "alice" }]);
  });
});

describe("invites", () => {
  const host = { playerId: "u_alice", userId: "alice", name: "Alice" };
  const guest = { playerId: "u_bob", userId: "bob", name: "Bob" };
  async function lobbyWithFriends(): Promise<string> {
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
    expect(Object.keys(invite!).sort()).toEqual(["expiresAt", "fromHandle", "fromName", "id", "tableCode"]);
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

  it("rejects a sender who has left the lobby", async () => {
    const code = await lobbyWithFriends();
    await tables.act(code, guest, { type: "join", identity: guest }, -1);
    await tables.act(code, guest, { type: "leave" }, -1);
    await rejects(friends.invite(bob, code, alice.id), "not_a_player");
  });

  it("removing the friend removes open invites", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    await friends.remove(alice, bob.id);
    expect((await friends.list(bob.id)).invites).toEqual([]);
  });

  it("tells the recipient which handle sent the invite", async () => {
    const code = await lobbyWithFriends();
    const aliceHandle = (await friends.list(alice.id)).handle;
    await friends.invite(alice, code, bob.id);
    expect((await friends.list(bob.id)).invites[0]).toMatchObject({ fromHandle: aliceHandle });
  });

  it("only the recipient can dismiss an invite", async () => {
    const code = await lobbyWithFriends();
    await friends.invite(alice, code, bob.id);
    const [invite] = (await friends.list(bob.id)).invites;
    await friends.dismissInvite(carol.id, invite!.id);
    expect((await friends.list(bob.id)).invites).toHaveLength(1);
  });
});

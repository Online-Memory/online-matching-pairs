import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadTable } from "@/server/db/tables";
import { effectiveColour, seededRng } from "@/server/engine";
import { FriendsService, type Account } from "@/server/friends/service";
import { TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const settings = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: false, tableName: "T" };
const alice: Account = { id: "alice", name: "Alice" };

let db: Awaited<ReturnType<typeof createTestDb>>;
let friends: FriendsService;
let tables: TableService;
let now: number;

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

describe("colour preferences", () => {
  it("are empty until set, and round-trip in priority order", async () => {
    expect(await friends.colourPrefs(alice.id)).toEqual([]);
    expect(await friends.setColourPrefs(alice, [9, 2, 14])).toEqual([9, 2, 14]);
    expect(await friends.colourPrefs(alice.id)).toEqual([9, 2, 14]);
    await friends.setColourPrefs(alice, []);
    expect(await friends.colourPrefs(alice.id)).toEqual([]);
  });

  it("a stored preference decides the host's colour at table creation", async () => {
    await friends.setColourPrefs(alice, [9]);
    const { code } = await tables.create(
      { playerId: "u_alice", userId: "alice", name: "Alice" },
      settings,
      await friends.colourPrefs(alice.id),
    );
    const state = (await loadTable(db, code))!.state;
    expect(effectiveColour(state.players[0]!)).toBe(9);
  });

  it("a joiner gets their preference through the service, and a rival falls back", async () => {
    const { code } = await tables.create({ playerId: "g_host", userId: null, name: "Host" }, settings, [4]);
    const guest = { playerId: "g_bob", userId: null, name: "Bob" };
    const snap = await tables.act(code, guest, { type: "join", identity: guest, colourPrefs: [4, 6] }, -1);
    expect(snap.view.players.map((p) => p.colour)).toEqual([4, 6]);
  });
});

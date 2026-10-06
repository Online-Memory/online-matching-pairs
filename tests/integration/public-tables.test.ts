import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seededRng, type Identity } from "@/server/engine";
import { TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

const base = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, tableName: "Friday showdown" };
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
  service = new TableService(db, { clock: () => now, rng: seededRng(7) });
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

describe("listPublic", () => {
  it("lists public lobbies, never private ones, and nothing secret", async () => {
    const pubLobby = (await service.create(alice, { ...base, isPublic: true })).code;
    await service.create(bob, { ...base, isPublic: false });

    const list = await service.listPublic();
    expect(list).toEqual([
      {
        code: pubLobby,
        tableName: "Friday showdown",
        theme: "001",
        pairs: 8,
        status: "lobby",
        seats: { taken: 1, max: 4 },
        hostName: "Alice",
        createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      },
    ]);
    expect(Object.keys(list[0]!).sort()).toEqual([
      "code",
      "createdAt",
      "hostName",
      "pairs",
      "seats",
      "status",
      "tableName",
      "theme",
    ]);
  });

  it("moves a started table to playing and drops it once finished", async () => {
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

  it("hides a started table that has been going for hours", async () => {
    const { code } = await service.create(alice, { ...base, isPublic: true });
    await service.act(code, bob, { type: "join", identity: bob }, -1);
    await service.act(code, alice, { type: "start" }, -1);
    now += 3 * 3_600_000;
    expect(await service.listPublic()).toEqual([]);
  });

  it("hides lobbies older than the idle window even if nobody polled them to abandoned", async () => {
    await service.create(alice, { ...base, isPublic: true });
    now += 30 * 60_000 + 1;
    expect(await service.listPublic()).toEqual([]);
  });

  it("caps the list at 50, newest first", async () => {
    const codes: string[] = [];
    for (let i = 0; i < 52; i++) {
      now += 1_000;
      codes.push((await service.create(alice, { ...base, isPublic: true })).code);
    }
    const list = await service.listPublic();
    expect(list).toHaveLength(50);
    expect(list[0]!.code).toBe(codes[51]);
  });
});

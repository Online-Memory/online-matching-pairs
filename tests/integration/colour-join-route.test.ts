import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { SnapshotResponse } from "@/lib/protocol";
import { seededRng } from "@/server/engine";
import type * as Tables from "@/server/tables";
import { TableService } from "@/server/tables/service";

import { createTestDb } from "./db";

type Viewer = { playerId: string; userId: string | null; accountName: string | null };
const holder = vi.hoisted(() => ({
  service: null as unknown,
  viewer: null as unknown,
  prefs: (async () => [] as number[]) as (userId: string) => Promise<number[]>,
}));

vi.mock("@/server/auth", () => ({ getOrCreateViewer: async () => holder.viewer }));
vi.mock("@/server/friends", () => ({
  getFriendsService: async () => ({
    colourPrefs: (userId: string) => holder.prefs(userId),
    clearInvitesForTable: async () => {},
  }),
}));
vi.mock("@/server/tables", async (original) => ({
  ...(await original<typeof Tables>()),
  getTableService: async () => holder.service,
}));

import { POST } from "@/app/api/tables/[code]/join/route";

const settings = { theme: "001", pairs: 8, maxPlayers: 4, turnSeconds: 20, isPublic: false, tableName: "T" };
let db: Awaited<ReturnType<typeof createTestDb>>;
let code: string;

const join = async (viewer: Viewer, body: object) => {
  holder.viewer = viewer;
  const response = await POST(
    new Request("http://x/api/tables/" + code + "/join?since=-1", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ code }) },
  );
  return {
    status: response.status,
    json: (await response.json()) as SnapshotResponse & { error?: { code: string } },
  };
};

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.reset();
  holder.service = new TableService(db, { clock: () => 1_700_000_000_000, rng: seededRng(5) });
  holder.prefs = async () => [];
  ({ code } = await (holder.service as TableService).create(
    { playerId: "g_host", userId: null, name: "Host" },
    settings,
  ));
});

describe("join route colours", () => {
  it("seats a guest in the colour they chose", async () => {
    const r = await join({ playerId: "g_a", userId: null, accountName: null }, { name: "Ann", colour: 7 });
    expect(r.status).toBe(200);
    expect(r.json.view.players.map((p: { colour: number }) => p.colour)).toEqual([0, 7]);
  });

  it("answers 409 colour_taken when the chosen colour is already held, and seats nobody", async () => {
    const r = await join({ playerId: "g_a", userId: null, accountName: null }, { name: "Ann", colour: 0 });
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe("colour_taken");
    const again = await join({ playerId: "g_b", userId: null, accountName: null }, { name: "Bob" });
    expect(again.json.view.players).toHaveLength(2);
  });

  it("rejects an out-of-range colour with 400", async () => {
    const r = await join({ playerId: "g_a", userId: null, accountName: null }, { name: "Ann", colour: 99 });
    expect(r.status).toBe(400);
  });

  it("uses a signed-in player's saved preferences", async () => {
    holder.prefs = async () => [9, 2];
    const r = await join({ playerId: "u_s", userId: "s", accountName: "Sam" }, {});
    expect(r.json.view.players.map((p: { colour: number }) => p.colour)).toEqual([0, 9]);
  });

  it("still joins, with the lowest free colour, when the preference lookup fails", async () => {
    holder.prefs = async () => {
      throw new Error("database hiccup");
    };
    const r = await join({ playerId: "u_s", userId: "s", accountName: "Sam" }, {});
    expect(r.status).toBe(200);
    expect(r.json.view.players.map((p: { colour: number }) => p.colour)).toEqual([0, 1]);
  });
});

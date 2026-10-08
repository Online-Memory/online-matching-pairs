import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Tables from "@/server/tables";

const create = vi.fn(async (..._args: unknown[]) => ({ code: "ABC234" }));
const listPublic = vi.fn(async () => [
  {
    code: "ABC234",
    tableName: "Friday showdown",
    theme: "001",
    pairs: 8,
    status: "lobby",
    seats: { taken: 1, max: 4 },
    hostName: "Alice",
    createdAt: "2026-10-05T08:00:00.000Z",
  },
]);

vi.mock("@/server/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof Tables>()),
  getTableService: async () => ({ create, listPublic }),
}));
vi.mock("@/server/auth", () => ({
  getOrCreateViewer: async () => ({ userId: null, playerId: "g_x" }),
  toIdentity: () => ({ playerId: "g_x", userId: null, name: "X" }),
}));

import { GET } from "@/app/api/public-tables/route";
import { POST } from "@/app/api/tables/route";

const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  POST(new Request("http://x/api/tables", { method: "POST", body: JSON.stringify(body) }), ctx);

beforeEach(() => create.mockClear());

describe("public table routes", () => {
  it("lists tables for anyone, uncached, with no board data", async () => {
    const res = await GET(new Request("http://x/api/public-tables"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/tiles|face|players/);
    expect(text).toContain("ABC234");
  });

  it("creates a public table when asked, and a private one otherwise", async () => {
    await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X", isPublic: true });
    expect(create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ isPublic: true }),
      [], // a guest host has no saved colours
    );

    await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X" });
    expect(create).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ isPublic: false }),
      [], // a guest host has no saved colours
    );
  });

  it("rejects a non-boolean visibility", async () => {
    const res = await post({ theme: "001", pairs: 8, turnSeconds: 20, name: "X", isPublic: "yes" });
    expect(res.status).toBe(400);
  });
});

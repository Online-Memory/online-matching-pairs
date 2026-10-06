import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET as leaderboard } from "@/app/api/leaderboard/route";
import { GET as stats } from "@/app/api/me/stats/route";

const ctx = { params: Promise.resolve({}) };

describe("ratings routes", () => {
  it("answer 401 to guests for stats and for the friends leaderboard", async () => {
    const mine = await stats(new Request("http://x/api/me/stats"), ctx);
    expect(mine.status).toBe(401);
    const friends = await leaderboard(new Request("http://x/api/leaderboard?scope=friends"), ctx);
    expect(friends.status).toBe(401);
    expect(await friends.json()).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("rejects an unknown scope", async () => {
    const response = await leaderboard(new Request("http://x/api/leaderboard?scope=everyone"), ctx);
    expect(response.status).toBe(400);
  });
});

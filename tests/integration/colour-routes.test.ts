import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET, PUT } from "@/app/api/me/colours/route";

const ctx = { params: Promise.resolve({}) };

describe("colour routes", () => {
  it("answer 401 to guests", async () => {
    expect((await GET(new Request("http://x/api/me/colours"), ctx)).status).toBe(401);
    const put = await PUT(
      new Request("http://x/api/me/colours", { method: "PUT", body: '{"colours":[1]}' }),
      ctx,
    );
    expect(put.status).toBe(401);
  });
});

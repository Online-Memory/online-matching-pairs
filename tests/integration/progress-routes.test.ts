import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET as progress } from "@/app/api/me/progress/route";

describe("progress route", () => {
  it("answers 401 to guests", async () => {
    const response = await progress(new Request("http://x/api/me/progress"), {
      params: Promise.resolve({}),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});

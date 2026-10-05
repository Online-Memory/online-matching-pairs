import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth", () => ({ getAccountUser: async () => null }));

import { GET } from "@/app/api/friends/route";
import { POST as invite } from "@/app/api/tables/[code]/invites/route";

describe("friends routes", () => {
  it("answer 401 to guests and when accounts are off", async () => {
    const poll = await GET(new Request("http://x/api/friends"), { params: Promise.resolve({}) });
    expect(poll.status).toBe(401);
    expect(await poll.json()).toMatchObject({ error: { code: "unauthorized" } });

    const sent = await invite(
      new Request("http://x/api/tables/ABC234/invites", { method: "POST", body: '{"userId":"b"}' }),
      { params: Promise.resolve({ code: "ABC234" }) },
    );
    expect(sent.status).toBe(401);
  });
});

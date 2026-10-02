import { describe, expect, it } from "vitest";

import { issueGuestToken, verifyGuestToken } from "./guest";

const secret = "s".repeat(32);

describe("guest token", () => {
  it("round-trips", () => {
    const { id, token } = issueGuestToken(secret);
    expect(verifyGuestToken(token, secret)).toBe(id);
  });

  it("rejects tampering, other secrets and junk", () => {
    const { token } = issueGuestToken(secret);
    const [id, mac] = token.split(".");
    const otherId = id!.slice(0, -1) + (id!.endsWith("A") ? "B" : "A");
    expect(verifyGuestToken(`${otherId}.${mac}`, secret)).toBeNull();
    expect(verifyGuestToken(token, "t".repeat(32))).toBeNull();
    expect(verifyGuestToken(`${token}.x`, secret)).toBeNull();
    expect(verifyGuestToken("", secret)).toBeNull();
    expect(verifyGuestToken(undefined, secret)).toBeNull();
  });
});

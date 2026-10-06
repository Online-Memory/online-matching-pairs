import { afterEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: () => ({ getSession }) }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEON_AUTH_BASE_URL: "https://auth.test", NEON_AUTH_COOKIE_SECRET: "s".repeat(32) }),
}));

import { getAccountUser } from "./neon";

afterEach(() => {
  getSession.mockReset();
  vi.restoreAllMocks();
});

describe("getAccountUser", () => {
  it("returns the signed-in user", async () => {
    getSession.mockResolvedValue({ data: { user: { id: "1", name: "Ann", email: "a@b.c" } }, error: null });
    await expect(getAccountUser()).resolves.toMatchObject({ id: "1", name: "Ann" });
  });

  it("returns null when there is no session", async () => {
    getSession.mockResolvedValue({ data: null, error: null });
    await expect(getAccountUser()).resolves.toBeNull();
  });

  it("returns null when upstream says the session is invalid", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 401, message: "Unauthorized" } });
    await expect(getAccountUser()).resolves.toBeNull();
  });

  it.each([429, 500, 503])("throws a retryable error when upstream fails with %i", async (status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValue({ data: null, error: { status, message: "boom" } });
    await expect(getAccountUser()).rejects.toMatchObject({ code: "conflict" });
  });

  it("throws a retryable error when the lookup itself throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockRejectedValue(new Error("network down"));
    await expect(getAccountUser()).rejects.toMatchObject({ code: "conflict" });
  });
});

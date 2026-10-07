import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@neondatabase/auth/next/server", () => ({ createNeonAuth: () => ({ getSession }) }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEON_AUTH_BASE_URL: "https://auth.test", NEON_AUTH_COOKIE_SECRET: "s".repeat(32) }),
}));

let sessionToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "__Secure-neon-auth.session_token" && sessionToken ? { name, value: sessionToken } : undefined,
  }),
}));

import { getAccountUser } from "./neon";

const ann = { data: { user: { id: "1", name: "Ann", email: "a@b.c" } }, error: null };

let tokenCount = 0;
beforeEach(() => {
  vi.useFakeTimers();
  // The cache is keyed by token and lives for the process, so every test signs in as a new session.
  sessionToken = `token-${++tokenCount}`;
});

afterEach(() => {
  vi.useRealTimers();
  getSession.mockReset();
  vi.restoreAllMocks();
});

describe("getAccountUser", () => {
  it("returns the signed-in user", async () => {
    getSession.mockResolvedValue(ann);
    await expect(getAccountUser()).resolves.toMatchObject({ id: "1", name: "Ann" });
  });

  it("returns null without asking upstream when there is no session cookie", async () => {
    sessionToken = undefined;
    await expect(getAccountUser()).resolves.toBeNull();
    expect(getSession).not.toHaveBeenCalled();
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

describe("getAccountUser cache", () => {
  it("looks a session up once while the entry is fresh", async () => {
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    vi.advanceTimersByTime(59_000);
    await expect(getAccountUser()).resolves.toMatchObject({ id: "1" });
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("looks up again once the entry is older than a minute", async () => {
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    vi.advanceTimersByTime(61_000);
    await getAccountUser();
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("shares one upstream call between concurrent lookups", async () => {
    getSession.mockResolvedValue(ann);
    await Promise.all([getAccountUser(), getAccountUser(), getAccountUser()]);
    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it("keeps sessions apart", async () => {
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    sessionToken = `${sessionToken}-other`;
    getSession.mockResolvedValue({ data: { user: { id: "2", name: "Bob", email: null } }, error: null });
    await expect(getAccountUser()).resolves.toMatchObject({ id: "2" });
  });

  it("serves the last known user while upstream is rate limiting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    vi.advanceTimersByTime(5 * 60_000);
    getSession.mockResolvedValue({ data: null, error: { status: 429, message: "Too many requests" } });
    await expect(getAccountUser()).resolves.toMatchObject({ id: "1" });
  });

  it("stops serving a stale user after ten minutes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    vi.advanceTimersByTime(11 * 60_000);
    getSession.mockResolvedValue({ data: null, error: { status: 429, message: "Too many requests" } });
    await expect(getAccountUser()).rejects.toMatchObject({ code: "conflict" });
  });

  it("does not cache a missing session", async () => {
    getSession.mockResolvedValue({ data: null, error: { status: 401, message: "Unauthorized" } });
    await getAccountUser();
    getSession.mockResolvedValue(ann);
    await expect(getAccountUser()).resolves.toMatchObject({ id: "1" });
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("drops a cached user once upstream says the session is gone", async () => {
    getSession.mockResolvedValue(ann);
    await getAccountUser();
    vi.advanceTimersByTime(61_000);
    getSession.mockResolvedValue({ data: null, error: null });
    await expect(getAccountUser()).resolves.toBeNull();
    getSession.mockResolvedValue({ data: null, error: { status: 429, message: "x" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(getAccountUser()).rejects.toMatchObject({ code: "conflict" });
  });
});

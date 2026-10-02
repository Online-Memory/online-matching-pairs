import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./env");
}

const base = {
  DATABASE_URL: "pglite:memory",
  GUEST_TOKEN_SECRET: "x".repeat(32),
  CRON_SECRET: "cron-secret",
};

describe("getEnv", () => {
  it("treats empty Neon Auth settings as accounts disabled", async () => {
    const { getEnv, authEnabled } = await load({
      ...base,
      NEON_AUTH_BASE_URL: "",
      NEON_AUTH_COOKIE_SECRET: "",
    });
    expect(getEnv().NEON_AUTH_BASE_URL).toBeUndefined();
    expect(authEnabled()).toBe(false);
  });

  it("requires both Neon Auth settings together", async () => {
    const { getEnv } = await load({ ...base, NEON_AUTH_BASE_URL: "https://auth.example.com" });
    expect(() => getEnv()).toThrow(/NEON_AUTH_COOKIE_SECRET/);
  });

  it("refuses PGlite on Vercel", async () => {
    const { getEnv } = await load({ ...base, VERCEL_ENV: "production" });
    expect(() => getEnv()).toThrow(/PGlite/);
  });

  it("rejects a short guest token secret", async () => {
    const { getEnv } = await load({ ...base, GUEST_TOKEN_SECRET: "short" });
    expect(() => getEnv()).toThrow(/GUEST_TOKEN_SECRET/);
  });
});

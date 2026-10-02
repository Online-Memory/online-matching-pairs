import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const nightly = Boolean(process.env.E2E_ALL_BROWSERS);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(nightly
      ? [
          { name: "firefox", use: { ...devices["Desktop Firefox"] } },
          { name: "webkit", use: { ...devices["Desktop Safari"] } },
        ]
      : []),
  ],
  // Expects a prior `pnpm build`. Without E2E_DATABASE_URL the server uses in-memory PGlite.
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/me`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "pglite:memory",
      GUEST_TOKEN_SECRET: "e2e-guest-token-secret-at-least-32-chars",
      CRON_SECRET: "e2e-cron-secret",
      // Always set, even to "": `next start` fills unset vars from .env.local, which points at production auth.
      NEON_AUTH_BASE_URL: process.env.NEON_AUTH_BASE_URL ?? "",
      NEON_AUTH_COOKIE_SECRET: process.env.NEON_AUTH_COOKIE_SECRET ?? "",
    },
  },
});

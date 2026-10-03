---
name: e2e
description: Run the Playwright end-to-end tests. Use only when the user asks for E2E, or when they say they're wrapping up the session ("done for today", "wrap up"). Never as part of routine verification.
---

# E2E

## Default: PGlite

```bash
pnpm build && pnpm test:e2e
```

`playwright.config.ts` starts `next start` on port 3100 with in-memory PGlite and blank Neon Auth variables, so this
touches no external service. Account tests that need Neon Auth skip themselves without it.

## Neon `e2e` branch (only if the user asks)

```bash
pnpm build && pnpm test:e2e:neon
```

Migrates the `e2e` branch and runs the suite against it, using `.env.e2e.local`. This command asks for permission;
never point E2E at `.env.local` (production).

## Writing or changing scenarios

Every scenario must import `test` from `tests/e2e/fixtures.ts` and create players with `newPlayer`. The fixture scans
every API response, theme image request and face-down tile DOM for leaked faces; a test that bypasses it gives no
anti-cheat coverage.

## Report

Say which command ran, how many tests passed/failed, and for failures the test name and first error line. Don't fix
failures unasked if the session is wrapping up; report them. Don't commit.

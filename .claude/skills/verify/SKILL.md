---
name: verify
description: Run this project's CI checks (lint, format, typecheck, Vitest) and fix failures. Use before saying work is done, or when the user asks to verify, check or "make CI pass". Does not run E2E.
---

# Verify

Run the checks in CI order. Stop at the first failure, fix it, and start again from that check.

1. `pnpm lint`
2. `pnpm format:check`. If it fails, run `pnpm exec prettier --write <files>` on the files it lists.
3. `pnpm typecheck`
4. `pnpm test`

Rules:

- Fix the cause. Don't disable lint rules, add `@ts-expect-error`, skip tests or loosen the server-only import boundary
  to get green. If a fix needs one of those, stop and ask the user.
- Don't run Playwright (`pnpm test:e2e*`); that is the `e2e` skill's job.
- Don't commit. Finish with a short report: which checks passed, what you changed to fix failures.

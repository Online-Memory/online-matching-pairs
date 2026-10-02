import "@testing-library/jest-dom/vitest";

process.env.GUEST_TOKEN_SECRET ??= "test-guest-token-secret-at-least-32-chars";
process.env.CRON_SECRET ??= "test-cron-secret";

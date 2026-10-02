import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/integration/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // `server-only` throws outside a React Server environment; tests run the server code directly.
    alias: { "server-only": new URL("./tests/server-only-stub.ts", import.meta.url).pathname },
    testTimeout: 20_000,
  },
});

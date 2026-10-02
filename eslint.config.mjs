import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

// Anything that can end up in a browser bundle must never reach the engine, the secret board or the DB.
const serverBoundary = {
  patterns: [
    {
      group: ["@/server", "@/server/*", "**/server/*", "server-only"],
      message: "Server code (engine, DB, auth) must not be imported from client-reachable modules.",
    },
    {
      group: ["@neondatabase/serverless", "@electric-sql/pglite", "pg"],
      message: "The browser never talks to the database.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      ".remember/**",
    ],
  },
  js.configs.recommended,
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: [
      "src/components/**",
      "src/lib/client/**",
      "src/lib/protocol/**",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/app/**/error.tsx",
      "src/app/**/not-found.tsx",
    ],
    rules: { "no-restricted-imports": ["error", serverBoundary] },
  },
  {
    // Playwright fixtures call `use()`, which is not React's hook.
    files: ["tests/e2e/**"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  {
    files: ["scripts/**", "*.config.*"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  prettier,
);

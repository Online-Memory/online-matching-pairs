// Stop hook: run the CI checks before Claude finishes, if the working tree has changes.
// Fast checks only (about 6s). Do not add Playwright here: E2E runs on demand via the `e2e` skill.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CHECKS = ["lint", "format:check", "typecheck", "test"];
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  // Run the checks anyway.
}

const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
if (status.status !== 0 || status.stdout.trim() === "") process.exit(0);

for (const check of CHECKS) {
  const run = spawnSync("pnpm", [check], { cwd: root, encoding: "utf8" });
  if (run.status === 0) continue;

  const tail = `${run.stdout}${run.stderr}`.trim().split("\n").slice(-40).join("\n");
  if (input.stop_hook_active) {
    // Already blocked once this turn; let Claude stop rather than loop, but tell the user.
    console.log(JSON.stringify({ systemMessage: `pnpm ${check} is still failing.` }));
    process.exit(0);
  }
  console.error(`pnpm ${check} failed. Fix it before finishing:\n\n${tail}`);
  process.exit(2);
}

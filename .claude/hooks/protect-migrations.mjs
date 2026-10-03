// PreToolUse hook: block edits to migrations that already exist.
// vercel-build runs `db:migrate` against Neon, so an applied migration must never change.
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

let filePath;
try {
  filePath = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.file_path;
} catch {
  process.exit(0);
}
if (!filePath) process.exit(0);

const abs = resolve(root, filePath);
const rel = relative(root, abs).split(sep).join("/");

if (rel.startsWith("db/migrations/") && existsSync(abs)) {
  console.error(`${rel}: applied migrations are immutable; add a new migration instead.`);
  process.exit(2);
}

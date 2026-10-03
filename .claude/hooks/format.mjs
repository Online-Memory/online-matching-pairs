// PostToolUse hook: run prettier on the file Claude just edited.
// Always exits 0 so a formatter failure never blocks the edit.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".sql"]);
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

try {
  const filePath = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.file_path;
  if (filePath && EXTENSIONS.has(extname(filePath))) {
    const abs = resolve(root, filePath);
    const rel = relative(root, abs);
    if (!rel.startsWith("..") && !isAbsolute(rel)) {
      spawnSync("pnpm", ["exec", "prettier", "--write", "--ignore-unknown", abs], {
        cwd: root,
        stdio: "ignore",
      });
    }
  }
} catch {
  // Never block the edit.
}
process.exit(0);

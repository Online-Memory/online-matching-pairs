import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("achievements migration", () => {
  it("applies after the progress migration and keeps one row per player and achievement", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const progress = files.findIndex((f) => f.endsWith("_progress.sql"));
    const achievements = files.findIndex((f) => f.endsWith("_achievements.sql"));
    expect(progress).toBeGreaterThan(0);
    expect(achievements).toBeGreaterThan(progress);
    for (const file of files) {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    }

    await db.exec(`INSERT INTO player_achievements (user_id, achievement_id) VALUES ('u1', 'first_game')`);
    await expect(
      db.exec(`INSERT INTO player_achievements (user_id, achievement_id) VALUES ('u1', 'first_game')`),
    ).rejects.toThrow();
    const rows = (
      await db.query<{ game_id: string | null; earned_at: Date }>(
        `SELECT game_id, earned_at FROM player_achievements`,
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.game_id).toBeNull();
    expect(rows[0]!.earned_at).toBeInstanceOf(Date);
    await db.close();
  });
});

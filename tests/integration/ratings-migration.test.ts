import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("ratings migration", () => {
  it("marks games finished before it as already rated and leaves other games unrated", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const index = files.findIndex((f) => f.endsWith("_ratings.sql"));
    expect(index).toBeGreaterThan(0);
    const up = async (file: string) => {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    };

    for (const file of files.slice(0, index)) await up(file);
    await db.exec(
      `INSERT INTO games (id, code, host_player_id, theme, pairs, max_players, turn_seconds, status, started_at, finished_at)
       VALUES ('00000000-0000-0000-0000-00000000000a', 'OLD234', 'p', '001', 8, 4, 20, 'finished',
               '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
              ('00000000-0000-0000-0000-00000000000b', 'LOB234', 'p', '001', 8, 4, 20, 'lobby', NULL, NULL)`,
    );
    await up(files[index]!);

    const rows = (
      await db.query<{ code: string; rated_at: Date | null }>(
        `SELECT code, rated_at FROM games ORDER BY code`,
      )
    ).rows;
    expect(rows[0]!.code).toBe("LOB234");
    expect(rows[0]!.rated_at).toBeNull();
    expect(rows[1]!.code).toBe("OLD234");
    expect(new Date(rows[1]!.rated_at!).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    await db.close();
  });
});

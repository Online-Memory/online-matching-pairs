import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("colour prefs migration", () => {
  it("adds profiles.colour_prefs, empty by default, limited to three palette indexes", async () => {
    const db = new PGlite();
    const dir = path.join(process.cwd(), "db", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const index = files.findIndex((f) => f.endsWith("_colour-prefs.sql"));
    expect(index).toBeGreaterThan(0);
    const up = async (file: string) => {
      const text = await readFile(path.join(dir, file), "utf8");
      await db.exec(text.split(/^-- Down Migration/m)[0]!.replace(/^-- Up Migration/m, ""));
    };

    for (const file of files.slice(0, index)) await up(file);
    await db.exec(
      `INSERT INTO profiles (user_id, handle, display_name, last_seen_at) VALUES ('u1', 'old_user', 'Old', now())`,
    );
    await up(files[index]!);

    const row = (await db.query<{ colour_prefs: number[] }>(`SELECT colour_prefs FROM profiles`)).rows[0]!;
    expect(row.colour_prefs).toEqual([]);

    await db.exec(`UPDATE profiles SET colour_prefs = '{15,0,7}'`);
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{1,2,3,4}'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{16}'`)).rejects.toThrow();
    await expect(db.exec(`UPDATE profiles SET colour_prefs = '{-1}'`)).rejects.toThrow();
    await db.close();
  });
});

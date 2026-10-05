import { describe, expect, it } from "vitest";

import { fitGrid } from "./fit-grid";

describe("fitGrid", () => {
  it("keeps the requested grid shape", () => {
    expect(fitGrid(100, 10, 1100, 700, 6)).toMatchObject({ cols: 10, rows: 10 });
    expect(fitGrid(24, 6, 1100, 700, 6)).toMatchObject({ cols: 6, rows: 4 });
  });

  it("is limited by the shorter side of the box", () => {
    // 10 rows in 700px: (700 - 9 * 6) / 10 = 64.6
    expect(fitGrid(100, 10, 1100, 700, 6).size).toBe(64);
    // 10 columns in 500px wide: (500 - 9 * 6) / 10 = 44.6
    expect(fitGrid(100, 10, 500, 900, 6).size).toBe(44);
  });

  it("never overflows the box", () => {
    const boxes: [number, number][] = [
      [1100, 700],
      [640, 900],
      [1600, 500],
    ];
    for (const [w, h] of boxes) {
      const { cols, rows, size } = fitGrid(72, 9, w, h, 6);
      expect(cols * size + (cols - 1) * 6).toBeLessThanOrEqual(w);
      expect(rows * size + (rows - 1) * 6).toBeLessThanOrEqual(h);
    }
  });

  it("caps tile size on a roomy box", () => {
    expect(fitGrid(16, 4, 2000, 2000, 8, 160).size).toBe(160);
  });

  it("returns an empty fit for an unmeasured box", () => {
    expect(fitGrid(16, 4, 0, 0, 6)).toEqual({ cols: 0, rows: 0, size: 0 });
  });
});

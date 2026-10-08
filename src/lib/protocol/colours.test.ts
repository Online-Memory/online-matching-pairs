import { describe, expect, it } from "vitest";

import {
  chooseColourRequestSchema,
  colourName,
  colourPrefsSchema,
  joinRequestSchema,
  PALETTE_SIZE,
  setColoursSchema,
} from ".";

describe("colour schemas", () => {
  it("accept up to three distinct palette indexes, in any order, or none", () => {
    expect(colourPrefsSchema.safeParse([]).success).toBe(true);
    expect(colourPrefsSchema.safeParse([15, 0, 7]).success).toBe(true);
  });
  it("reject duplicates, more than three, and indexes outside the palette", () => {
    expect(colourPrefsSchema.safeParse([1, 1]).success).toBe(false);
    expect(colourPrefsSchema.safeParse([1, 2, 3, 4]).success).toBe(false);
    expect(colourPrefsSchema.safeParse([PALETTE_SIZE]).success).toBe(false);
    expect(colourPrefsSchema.safeParse([-1]).success).toBe(false);
    expect(colourPrefsSchema.safeParse([1.5]).success).toBe(false);
    expect(setColoursSchema.safeParse({ colours: "red" }).success).toBe(false);
  });
  it("validate the colour on join and on choose", () => {
    expect(joinRequestSchema.safeParse({ name: "Sam", colour: 3 }).success).toBe(true);
    expect(joinRequestSchema.safeParse({}).success).toBe(true);
    expect(joinRequestSchema.safeParse({ colour: 99 }).success).toBe(false);
    expect(chooseColourRequestSchema.safeParse({}).success).toBe(false);
  });
  it("names colours by index", () => {
    expect(colourName(3)).toBe("Coral");
    expect(colourName(99)).toBe("Unknown");
  });
});

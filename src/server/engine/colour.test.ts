import { describe, expect, it } from "vitest";

import { PALETTE_SIZE } from "@/lib/protocol";

import { effectiveColour, pickColour } from "./colour";

describe("pickColour", () => {
  it("takes the first free preference", () => {
    expect(pickColour(new Set(), [5, 2, 9])).toBe(5);
  });
  it("skips taken preferences in order", () => {
    expect(pickColour(new Set([5]), [5, 2, 9])).toBe(2);
    expect(pickColour(new Set([5, 2]), [5, 2, 9])).toBe(9);
  });
  it("falls back to the lowest free colour when every preference is taken", () => {
    expect(pickColour(new Set([5, 2, 9, 0, 1]), [5, 2, 9])).toBe(3);
  });
  it("uses the lowest free colour with no preferences", () => {
    expect(pickColour(new Set(), [])).toBe(0);
    expect(pickColour(new Set([0, 1]))).toBe(2);
  });
  it("ignores preferences outside the palette", () => {
    expect(pickColour(new Set(), [-1, 99, 2.5, 4])).toBe(4);
  });
  it("throws when the palette is exhausted", () => {
    const all = new Set(Array.from({ length: PALETTE_SIZE }, (_, i) => i));
    expect(() => pickColour(all, [])).toThrow();
  });
});

describe("effectiveColour", () => {
  it("is the stored colour, else the seat (tables saved before colours existed)", () => {
    expect(effectiveColour({ colour: 7, seat: 1 })).toBe(7);
    expect(effectiveColour({ colour: undefined, seat: 3 })).toBe(3);
  });
});

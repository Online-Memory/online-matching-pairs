import { describe, expect, it } from "vitest";

import { faceSprite, themeSpriteUrl } from "./themes";

describe("faceSprite", () => {
  it("points at the theme's sprite sheet", () => {
    expect(faceSprite("001", 1).backgroundImage).toBe(`url(${themeSpriteUrl("001")})`);
  });

  it("puts face 1 in the top-left cell and shows one cell of an 8 x 7 sheet", () => {
    const sprite = faceSprite("001", 1);
    expect(sprite.backgroundSize).toBe("800% 700%");
    expect(sprite.backgroundPosition).toBe("0% 0%");
  });

  it("lays faces out row by row", () => {
    expect(faceSprite("001", 8).backgroundPosition).toBe("100% 0%");
    expect(faceSprite("001", 9).backgroundPosition).toBe("0% 16.666666666666664%");
    expect(faceSprite("001", 50).backgroundPosition).toBe(`${(1 / 7) * 100}% 100%`);
  });

  it("sizes the sheet from the theme's face count", () => {
    expect(faceSprite("008", 36).backgroundSize).toBe("800% 500%");
    expect(faceSprite("008", 36).backgroundPosition).toBe(`${(3 / 7) * 100}% 100%`);
  });
});

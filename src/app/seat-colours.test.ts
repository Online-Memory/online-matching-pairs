import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE, PALETTE_SIZE } from "@/lib/protocol";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

type Rgb = [number, number, number];
const block = (selector: RegExp) => css.match(selector)![1]!;
const THEMES = {
  light: block(/^:root\s*\{([\s\S]*?)^\}/m),
  dark: block(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m),
};
const variable = (text: string, name: string) =>
  text.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!.toLowerCase();
const seatColours = (text: string) =>
  Array.from({ length: PALETTE_SIZE }, (_, i) => variable(text, `seat-${i}`));

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const linear = (hex: string): Rgb => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16))) as Rgb;
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const oklab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const delta = (a: Rgb, b: Rgb) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Machado et al. 2009, severity 1.0, applied in linear RGB.
const CVD: Record<string, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const simulate = (rgb: Rgb, m: number[][]): Rgb =>
  m.map((row) => Math.min(1, Math.max(0, row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]))) as Rgb;
/** Worst case over normal vision and the three colour-blind types (their distances are compressed, so scaled up). */
const gap = (a: Rgb, b: Rgb) =>
  Math.min(
    delta(oklab(a), oklab(b)),
    ...Object.values(CVD).map((m) => delta(oklab(simulate(a, m)), oklab(simulate(b, m))) / 0.62),
  );

describe("seat colours", () => {
  it("PALETTE_SIZE is 16", () => expect(PALETTE_SIZE).toBe(16));

  it.each(Object.entries(THEMES))("%s theme defines every PALETTE colour as --seat-N", (theme, text) => {
    expect(seatColours(text)).toEqual(PALETTE.map((c) => c[theme as "light" | "dark"]));
  });

  // Tiles only get --seat from a [data-seat] rule; without one the ownership border silently vanishes.
  it.each(Array.from({ length: PALETTE_SIZE }, (_, seat) => seat))(
    "colour %i has a [data-seat] rule",
    (seat) => {
      expect(css).toMatch(
        new RegExp(`\\[data-seat="${seat}"\\]\\s*\\{\\s*--seat:\\s*var\\(--seat-${seat}\\)`),
      );
    },
  );

  it.each(Object.entries(THEMES))("%s theme: every pair is at least 7 apart", (_, text) => {
    const colours = seatColours(text).map(linear);
    for (let i = 0; i < colours.length; i++) {
      for (let j = i + 1; j < colours.length; j++) {
        expect(
          gap(colours[i]!, colours[j]!),
          `${PALETTE[i]!.name} vs ${PALETTE[j]!.name}`,
        ).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it.each(Object.entries(THEMES))("%s theme: 3:1 against the page and card, clear of --signal", (_, text) => {
    const backgrounds = [linear(variable(text, "paper")), linear(variable(text, "card"))];
    const signal = oklab(linear(variable(THEMES.light, "signal")));
    seatColours(text).forEach((hex, i) => {
      const rgb = linear(hex);
      for (const bg of backgrounds) {
        expect(contrast(rgb, bg), `${PALETTE[i]!.name} contrast`).toBeGreaterThanOrEqual(3);
      }
      expect(delta(oklab(rgb), signal), `${PALETTE[i]!.name} vs signal`).toBeGreaterThanOrEqual(12);
    });
  });
});

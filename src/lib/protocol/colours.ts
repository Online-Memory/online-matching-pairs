import { z } from "zod";

/**
 * Player colours. The index is `PlayerView.colour`. The hex values are mirrored as `--seat-N` in
 * `globals.css`; `src/app/seat-colours.test.ts` keeps them equal and checks separation and contrast.
 * Chosen by a max-min search over the Vecteezy "RGB 24 Color Wheel" hues (see the colour-preferences spec).
 */
export const PALETTE = [
  { name: "Olive", light: "#96902b", dark: "#faf7aa" },
  { name: "Brown", light: "#7d4014", dark: "#c68862" },
  { name: "Maroon", light: "#76080d", dark: "#c15e55" },
  { name: "Coral", light: "#c6585d", dark: "#fea0a0" },
  { name: "Wine", light: "#6a3446", dark: "#b2798a" },
  { name: "Raspberry", light: "#ae1173", dark: "#fd73bb" },
  { name: "Mauve", light: "#9a688b", dark: "#e5b2d5" },
  { name: "Purple", light: "#5e0e70", dark: "#a560b7" },
  { name: "Lavender", light: "#755eac", dark: "#bda9f6" },
  { name: "Indigo", light: "#2f05ac", dark: "#666bf5" },
  { name: "Navy", light: "#263f92", dark: "#6988da" },
  { name: "Blue", light: "#3864f3", dark: "#7ba0fe" },
  { name: "Sky", light: "#1c99c6", dark: "#85d7fd" },
  { name: "Sea green", light: "#50967f", dark: "#a0e1ca" },
  { name: "Green", light: "#46880a", dark: "#93d36e" },
  { name: "Moss", light: "#5f6a1e", dark: "#a6b36f" },
] as const;

export const PALETTE_SIZE = PALETTE.length;
export const MAX_COLOUR_PREFS = 3;

export const colourSchema = z
  .number()
  .int()
  .min(0)
  .max(PALETTE_SIZE - 1);
/** Most wanted first. Each colour at most once. */
export const colourPrefsSchema = z
  .array(colourSchema)
  .max(MAX_COLOUR_PREFS)
  .refine((colours) => new Set(colours).size === colours.length, "Pick each colour only once");

export const colourName = (index: number) => PALETTE[index]?.name ?? "Unknown";

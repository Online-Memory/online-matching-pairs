// Tile art from the original online-memory app, sliced into one image per face by scripts/slice-themes.mjs.
export const THEMES = [
  { id: "001", name: "Italy", maxPairs: 50 },
  { id: "002", name: "Food", maxPairs: 50 },
  { id: "003", name: "World", maxPairs: 50 },
  { id: "004", name: "Animals", maxPairs: 50 },
  { id: "005", name: "Food 2", maxPairs: 50 },
  { id: "006", name: "Kids", maxPairs: 50 },
  { id: "007", name: "Nature", maxPairs: 50 },
  { id: "008", name: "Frutta e Verdura", maxPairs: 36 },
  { id: "009", name: "Plants & Flowers", maxPairs: 50 },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

export const THEME_IDS = THEMES.map((t) => t.id) as [ThemeId, ...ThemeId[]];

/** Board sizes offered to the host, as pair counts (16 to 100 tiles). */
export const PAIR_OPTIONS = [8, 12, 18, 24, 36, 50] as const;

export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id);
}

export function faceImageUrl(theme: string, face: number) {
  return `/themes/${theme}/${face}.webp`;
}

export function themePreviewUrl(theme: string) {
  return `/themes/${theme}/preview.webp`;
}

/** Columns that keep the board roughly square, e.g. 16 -> 4, 24 -> 6, 100 -> 10. */
export function boardColumns(tileCount: number) {
  const exact = Math.sqrt(tileCount);
  if (Number.isInteger(exact)) return exact;
  for (let cols = Math.ceil(exact); cols <= tileCount; cols++) {
    if (tileCount % cols === 0) return cols;
  }
  return Math.ceil(exact);
}

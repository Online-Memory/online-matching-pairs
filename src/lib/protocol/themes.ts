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

/** Faces per row of a theme sprite; scripts/slice-themes.mjs lays the sheet out the same way. */
export const SPRITE_COLUMNS = 8;

export function themeSpriteUrl(theme: string) {
  return `/themes/${theme}/sprite.webp`;
}

/**
 * Where a face sits in its theme's sprite sheet (faces are numbered from 1, row by row), as the
 * CSS that shows just that cell.
 */
export function faceSprite(theme: string, face: number) {
  const rows = Math.ceil((getTheme(theme)?.maxPairs ?? face) / SPRITE_COLUMNS);
  const cell = face - 1;
  const col = cell % SPRITE_COLUMNS;
  const row = Math.floor(cell / SPRITE_COLUMNS);
  const percent = (index: number, count: number) => (count > 1 ? (index / (count - 1)) * 100 : 0);
  return {
    backgroundImage: `url(${themeSpriteUrl(theme)})`,
    backgroundSize: `${SPRITE_COLUMNS * 100}% ${rows * 100}%`,
    backgroundPosition: `${percent(col, SPRITE_COLUMNS)}% ${percent(row, rows)}%`,
  };
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

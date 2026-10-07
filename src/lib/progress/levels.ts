/** Total XP needed to reach `level` (level 1 needs none). */
export const xpForLevel = (level: number) => 50 * level * (level - 1);

/** Level is derived from XP, never stored. `xpForNext` is the width of the current level. */
export function levelForXp(xp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  const safe = Math.max(0, Math.floor(xp));
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * safe) / 50)) / 2));
  while (xpForLevel(level + 1) <= safe) level++;
  while (level > 1 && xpForLevel(level) > safe) level--;
  return {
    level,
    xpIntoLevel: safe - xpForLevel(level),
    xpForNext: xpForLevel(level + 1) - xpForLevel(level),
  };
}

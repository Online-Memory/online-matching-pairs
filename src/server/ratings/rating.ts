import "server-only";

export const START_RATING = 1000;
export const RATING_FLOOR = 100;
export const K_ESTABLISHED = 32;
export const K_PROVISIONAL = 48;
/** Players with fewer rated games than this move faster, so a newcomer settles quickly. */
export const PROVISIONAL_GAMES = 10;
/** Pairs that already played each other within this window earn less from rematches. */
export const REPEAT_WINDOW_HOURS = 24;
const REPEAT_STEP = 0.25;
const REPEAT_MIN_WEIGHT = 0.25;

export type RatingInput = { userId: string; rating: number; ratedGames: number; rank: number };
export type RatingResult = { userId: string; newRating: number; delta: number; won: boolean };

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** `k` = rated games this pair already shared in the window. */
export const repeatWeight = (k: number) => Math.max(REPEAT_MIN_WEIGHT, 1 - REPEAT_STEP * k);

/**
 * Pairwise Elo for a free-for-all: every player is scored against every other as if they had played
 * head to head, then the sum is spread over the `n - 1` opponents so a big table can't swing a rating
 * further than a duel. Equal ranks tie (0.5). Pure: no I/O, no clock.
 */
export function computeRatings(
  players: readonly RatingInput[],
  repeatCounts: ReadonlyMap<string, number> = new Map(),
): RatingResult[] {
  const n = players.length;
  if (n < 2) return players.map((x) => ({ userId: x.userId, newRating: x.rating, delta: 0, won: false }));

  return players.map((me) => {
    const k = me.ratedGames < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
    let sum = 0;
    for (const other of players) {
      if (other.userId === me.userId) continue;
      const actual = me.rank < other.rank ? 1 : me.rank === other.rank ? 0.5 : 0;
      const expected = 1 / (1 + 10 ** ((other.rating - me.rating) / 400));
      const weight = repeatWeight(repeatCounts.get(pairKey(me.userId, other.userId)) ?? 0);
      sum += weight * (actual - expected);
    }
    const newRating = Math.max(RATING_FLOOR, me.rating + Math.round((k / (n - 1)) * sum));
    return { userId: me.userId, newRating, delta: newRating - me.rating, won: me.rank === 1 };
  });
}

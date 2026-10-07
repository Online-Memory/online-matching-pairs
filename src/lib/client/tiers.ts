export const TIER_ORDER = ["bronze", "silver", "gold", "platinum", "diamond"] as const;
export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABEL: Record<Tier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  diamond: "Diamond",
};

/** Lowest rating of each tier. New players start at 1000, which is Silver. */
const FLOOR: Record<Tier, number> = { bronze: 0, silver: 900, gold: 1100, platinum: 1300, diamond: 1500 };

export const tierRank = (tier: Tier) => TIER_ORDER.indexOf(tier);

export function tierForRating(rating: number): { tier: Tier; next: Tier | null; progress: number } {
  let index = 0;
  TIER_ORDER.forEach((tier, i) => {
    if (rating >= FLOOR[tier]) index = i;
  });
  const tier = TIER_ORDER[index]!;
  const next = TIER_ORDER[index + 1] ?? null;
  const progress = next ? (rating - FLOOR[tier]) / (FLOOR[next] - FLOOR[tier]) : 1;
  return { tier, next, progress: Math.min(1, Math.max(0, progress)) };
}

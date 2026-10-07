import { TIER_LABEL, type Tier } from "@/lib/client/tiers";

/** A rank tier (Bronze to Diamond), derived from a rating. Colour comes from `data-tier` in the stylesheet. */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className="tier-badge" data-tier={tier}>
      {TIER_LABEL[tier]}
    </span>
  );
}

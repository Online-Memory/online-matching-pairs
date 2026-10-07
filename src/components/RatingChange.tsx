"use client";

import { useEffect, useRef, useState } from "react";

import { TIER_LABEL, tierForRating, tierRank } from "@/lib/client/tiers";
import { useCountUp } from "@/lib/client/use-count-up";
import { useMe } from "@/lib/client/use-me";
import { useRatingChange, type RatingChange as Change } from "@/lib/client/use-rating-change";

import { ConfettiBurst } from "./Confetti";
import { TierBadge } from "./TierBadge";

/** The count-up takes this long; the promotion lands just after it. */
const COUNT_MS = 1000;

/**
 * Its own component so the count-up only mounts once the rating exists, and so starts at `before`
 * instead of flashing 0 while the server is still rating the game.
 */
function RatingLine({ change }: { change: Change }) {
  const shown = useCountUp(change.after, { from: change.before, durationMs: COUNT_MS });
  const delta = change.after - change.before;
  const before = tierForRating(change.before).tier;
  const after = tierForRating(change.after).tier;
  const promoted = tierRank(after) > tierRank(before);

  const bannerRef = useRef<HTMLParagraphElement>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!promoted) return;
    const box = bannerRef.current?.getBoundingClientRect();
    if (box) setOrigin({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [promoted]);

  return (
    <>
      <p className="rating-change" role="status">
        Rating {change.before} → {shown} ({delta >= 0 ? "+" : "−"}
        {Math.abs(delta)}) <TierBadge tier={after} />
      </p>
      {promoted && (
        <p className="promotion" ref={bannerRef}>
          Promoted to {TIER_LABEL[after]}!
        </p>
      )}
      {promoted && origin && <ConfettiBurst x={origin.x} y={origin.y} count={60} delayMs={COUNT_MS} />}
    </>
  );
}

/** "Rating 1000 → 1024 (+24)" once the server has rated the game. Nothing for guests and solo games. */
export function RatingChange({ code, versus }: { code: string; versus: boolean }) {
  const me = useMe();
  const change = useRatingChange(code, versus && Boolean(me?.user));
  return change ? <RatingLine change={change} /> : null;
}

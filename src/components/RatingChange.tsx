"use client";

import { useMe } from "@/lib/client/use-me";
import { useRatingChange } from "@/lib/client/use-rating-change";

/** "Rating 1000 → 1024 (+24)" once the server has rated the game. Nothing for guests and solo games. */
export function RatingChange({ code, versus }: { code: string; versus: boolean }) {
  const me = useMe();
  const change = useRatingChange(code, versus && Boolean(me?.user));
  if (!change) return null;
  const delta = change.after - change.before;
  return (
    <p className="rating-change" role="status">
      Rating {change.before} → {change.after} ({delta >= 0 ? "+" : "−"}
      {Math.abs(delta)})
    </p>
  );
}

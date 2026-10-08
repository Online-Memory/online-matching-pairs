"use client";

import { useEffect, useState } from "react";

const SUGGESTIONS = [
  "Friday night showdown",
  "Family rematch",
  "Office lunch break",
  "Grandma's revenge",
  "Pairs at the pub",
];

const INTERVAL_MS = 3000;

/**
 * A decorative stand-in for `placeholder` that cycles through suggestions. Native placeholders can't
 * animate, so this sits over the input (pointer-events: none) and disappears once the field has a value.
 */
export function RotatingPlaceholder({ hidden }: { hidden: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (hidden) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % SUGGESTIONS.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hidden]);

  if (hidden) return null;
  return (
    <span className="rotating-placeholder" aria-hidden="true">
      {/* The key remounts the span so the CSS entrance animation replays on each change. */}
      <span key={index} className="rotating-placeholder-text">
        {SUGGESTIONS[index]}
      </span>
    </span>
  );
}

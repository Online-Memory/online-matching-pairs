"use client";

import { useEffect, useState } from "react";

type Options = { from?: number; durationMs?: number; delayMs?: number };

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * An integer that eases from `from` to `target` (cubic ease-out), for score and rating reveals. Under
 * reduced motion it is simply `target`. Cancels its timer and frame on unmount.
 */
export function useCountUp(
  target: number,
  { from = 0, durationMs = 900, delayMs = 0 }: Options = {},
): number {
  const reduce = reducedMotion();
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const t = Math.min(1, (now - startedAt) / durationMs);
      setValue(Math.round(from + (target - from) * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [reduce, target, from, durationMs, delayMs]);

  return reduce ? target : value;
}

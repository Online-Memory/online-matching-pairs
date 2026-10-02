import "server-only";

import { randomInt } from "node:crypto";

import type { Rng } from "./state";

/** Production shuffle source. Never Math.random: board order must not be predictable. */
export const cryptoRng: Rng = (maxExclusive) => randomInt(maxExclusive);

/** Deterministic generator for tests only (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(unit * maxExclusive);
  };
}

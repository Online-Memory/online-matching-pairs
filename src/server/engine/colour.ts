import "server-only";

import { PALETTE_SIZE } from "@/lib/protocol";

import type { GameState, PlayerState } from "./state";

/** Tables saved before colours existed have none on the player; their colour was the seat index. */
export const effectiveColour = (p: Pick<PlayerState, "colour" | "seat">): number => p.colour ?? p.seat;

/** Colours held by players who are still at the table. */
export function takenColours(s: GameState): Set<number> {
  return new Set(s.players.filter((p) => p.status !== "left").map(effectiveColour));
}

const inPalette = (c: number) => Number.isInteger(c) && c >= 0 && c < PALETTE_SIZE;

/** The first free preference, else the lowest free colour. Pure: no randomness, no I/O. */
export function pickColour(taken: ReadonlySet<number>, prefs: readonly number[] = []): number {
  for (const c of prefs) if (inPalette(c) && !taken.has(c)) return c;
  for (let c = 0; c < PALETTE_SIZE; c++) if (!taken.has(c)) return c;
  // Unreachable while MAX_PLAYERS < PALETTE_SIZE; fail loudly if someone raises one without the other.
  throw new Error("No free colour left");
}

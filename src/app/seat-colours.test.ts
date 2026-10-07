import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_PLAYERS } from "@/lib/protocol";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("seat colours", () => {
  // Tiles only get --seat from a [data-seat] rule; without one the ownership border silently vanishes.
  it.each(Array.from({ length: MAX_PLAYERS }, (_, seat) => seat))(
    "seat %i has a [data-seat] rule",
    (seat) => {
      expect(css).toMatch(
        new RegExp(`\\[data-seat="${seat}"\\]\\s*\\{\\s*--seat:\\s*var\\(--seat-${seat}\\)`),
      );
    },
  );
});

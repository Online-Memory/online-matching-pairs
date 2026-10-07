# Post-game payoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An animated podium, award chips, a rating count-up with a tier-promotion moment, and Bronze-to-Diamond tier badges on the results screen, leaderboard and stats panel.

**Architecture:** Entirely client-side. Two pure modules (`tiers.ts`, `awards.ts`) and one hook (`use-count-up.ts`) feed small components (`TierBadge`, `Podium`, `AwardChips`) wired into `Results`, `RatingChange`, `Leaderboard` and `StatsPanel`. All data already exists in the finished `TableView` and `useRatingChange`.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (jsdom), plain CSS in `src/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-10-07-post-game-payoff-design.md`

## Global Constraints

- No server, protocol or schema change. Nothing under `src/server/` or `src/lib/protocol/` is touched.
- All animation sits behind `@media (prefers-reduced-motion: no-preference)`; under reduced motion the final values show immediately and no confetti is drawn.
- **No git operations.** CLAUDE.md: git is the user's call. Leave everything uncommitted; there are no commit steps.
- Run `verify` (lint → format:check → typecheck → test) before declaring done. Do **not** run Playwright/E2E.
- Match existing style: double quotes, 2-space indent, comments only for non-obvious "why".
- The working tree holds unrelated uncommitted work (a `cheats` feature, Phase 1 juice). Do not revert or reformat it; make targeted edits only. `src/app/globals.css` is shared: insert your CSS at the stated anchors, never rewrite the file.
- Tier thresholds (verbatim from the spec): Bronze below 900; Silver 900-1099; Gold 1100-1299; Platinum 1300-1499; Diamond 1500 and above.

## Review Focus

- Podium with ties (ranks 1, 1, 3 → two names on step 1, then step 2 is the rank-3 group), a 2-player game (two steps only) and a 1-player game (no podium at all).
- A player with 0 pairs and 0 moves must not get "Flawless" (`moves === pairs` is trivially true): it needs `pairs >= 3`.
- `RatingChange` must not flash `0` before counting: it mounts its animated line only once the rating exists, starting from `before`.
- A drop across a tier boundary (demotion), staying in the same tier, and `before === after` must never show "Promoted".
- The count-up must show its final value at once under reduced motion, and must not update state after unmount.

---

### Task 1: Tiers

**Files:**

- Create: `src/lib/client/tiers.ts`
- Test: `src/lib/client/tiers.test.ts`

**Interfaces:**

- Produces:
  - `type Tier = "bronze" | "silver" | "gold" | "platinum" | "diamond"`
  - `TIER_ORDER: readonly Tier[]` (lowest first)
  - `TIER_LABEL: Record<Tier, string>` ("Bronze", …)
  - `tierRank(tier: Tier): number` (index in `TIER_ORDER`)
  - `tierForRating(rating: number): { tier: Tier; next: Tier | null; progress: number }`; `progress` is 0 to 1 within the tier, 1 for Diamond.

- [ ] **Step 1: Write the failing test**

`src/lib/client/tiers.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { TIER_LABEL, TIER_ORDER, tierForRating, tierRank } from "./tiers";

describe("tierForRating", () => {
  it.each([
    [100, "bronze"],
    [899, "bronze"],
    [900, "silver"],
    [1000, "silver"],
    [1099, "silver"],
    [1100, "gold"],
    [1299, "gold"],
    [1300, "platinum"],
    [1499, "platinum"],
    [1500, "diamond"],
    [2400, "diamond"],
  ] as const)("rating %i is %s", (rating, tier) => {
    expect(tierForRating(rating).tier).toBe(tier);
  });

  it("reports the next tier and progress through the current one", () => {
    expect(tierForRating(1000)).toMatchObject({ tier: "silver", next: "gold", progress: 0.5 });
    expect(tierForRating(900).progress).toBe(0);
    expect(tierForRating(1500)).toMatchObject({ tier: "diamond", next: null, progress: 1 });
  });

  it("keeps progress within 0 to 1", () => {
    for (const r of [0, 100, 899, 1099, 1499, 5000]) {
      const { progress } = tierForRating(r);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("tier helpers", () => {
  it("ranks tiers from lowest to highest and labels each", () => {
    expect(TIER_ORDER.map(tierRank)).toEqual([0, 1, 2, 3, 4]);
    expect(tierRank("gold")).toBeGreaterThan(tierRank("silver"));
    expect(TIER_LABEL.platinum).toBe("Platinum");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/client/tiers.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/client/tiers.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/client/tiers.test.ts`
Expected: PASS.

---

### Task 2: Awards

**Files:**

- Create: `src/lib/client/awards.ts`
- Test: `src/lib/client/awards.test.ts`

**Interfaces:**

- Produces:
  - `type Award = "streak" | "flawless" | "dominant"`
  - `AWARD_LABEL: Record<Award, string>` ("Longest streak", "Flawless", "Dominant")
  - `computeAwards(players: readonly PlayerView[], totalPairs: number): Record<string, Award[]>`: keyed by player id; only players with at least one award appear; `{}` for fewer than 2 players.

- [ ] **Step 1: Write the failing test**

`src/lib/client/awards.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { PlayerView } from "@/lib/protocol";

import { AWARD_LABEL, computeAwards } from "./awards";

const player = (id: string, over: Partial<PlayerView> = {}): PlayerView => ({
  id,
  name: id,
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: 4,
  pairs: 2,
  streak: 0,
  bestStreak: 1,
  rank: 1,
  ...over,
});

describe("computeAwards", () => {
  it("gives nothing to a solo game", () => {
    expect(computeAwards([player("a", { bestStreak: 8, moves: 8, pairs: 8 })], 8)).toEqual({});
  });

  it("awards the longest streak, shared on a tie, and only from 3 up", () => {
    const awards = computeAwards(
      [player("a", { bestStreak: 4 }), player("b", { bestStreak: 4 }), player("c", { bestStreak: 2 })],
      20,
    );
    expect(awards.a).toContain("streak");
    expect(awards.b).toContain("streak");
    expect(awards.c).toBeUndefined();
    expect(computeAwards([player("a", { bestStreak: 2 }), player("b", { bestStreak: 1 })], 20)).toEqual({});
  });

  it("awards Flawless for a miss-free game of at least 3 pairs, never for an empty one", () => {
    const awards = computeAwards(
      [
        player("a", { pairs: 3, moves: 3 }),
        player("b", { pairs: 0, moves: 0 }),
        player("c", { pairs: 2, moves: 2 }),
      ],
      20,
    );
    expect(awards.a).toContain("flawless");
    expect(awards.b).toBeUndefined();
    expect(awards.c).toBeUndefined();
  });

  it("awards Dominant to more than half of all pairs, not exactly half", () => {
    const awards = computeAwards(
      [player("a", { pairs: 5, moves: 9 }), player("b", { pairs: 5, moves: 9 })],
      10,
    );
    expect(awards).toEqual({});
    const won = computeAwards([player("a", { pairs: 6, moves: 9 }), player("b", { pairs: 4, moves: 9 })], 10);
    expect(won.a).toEqual(["dominant"]);
  });

  it("can give one player several awards", () => {
    const awards = computeAwards(
      [player("a", { pairs: 6, moves: 6, bestStreak: 6 }), player("b", { pairs: 2, moves: 5 })],
      8,
    );
    expect(awards.a).toEqual(["streak", "flawless", "dominant"]);
  });

  it("labels every award", () => {
    expect(AWARD_LABEL).toEqual({ streak: "Longest streak", flawless: "Flawless", dominant: "Dominant" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/client/awards.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/client/awards.ts`:

```ts
import type { PlayerView } from "@/lib/protocol";

export type Award = "streak" | "flawless" | "dominant";

export const AWARD_LABEL: Record<Award, string> = {
  streak: "Longest streak",
  flawless: "Flawless",
  dominant: "Dominant",
};

const STREAK_MIN = 3;
const FLAWLESS_MIN_PAIRS = 3;

/**
 * Awards for a finished game, from numbers every player already sees. Versus games only: a solo game
 * has nobody to be better than. Keyed by player id; players without an award are absent.
 */
export function computeAwards(players: readonly PlayerView[], totalPairs: number): Record<string, Award[]> {
  if (players.length < 2) return {};
  const longest = Math.max(...players.map((p) => p.bestStreak));
  const out: Record<string, Award[]> = {};
  for (const p of players) {
    const earned: Award[] = [];
    if (longest >= STREAK_MIN && p.bestStreak === longest) earned.push("streak");
    // `moves === pairs` alone is true for someone who never played, hence the minimum.
    if (p.pairs >= FLAWLESS_MIN_PAIRS && p.moves === p.pairs) earned.push("flawless");
    if (p.pairs * 2 > totalPairs) earned.push("dominant");
    if (earned.length > 0) out[p.id] = earned;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/client/awards.test.ts`
Expected: PASS.

---

### Task 3: Count-up hook

**Files:**

- Create: `src/lib/client/use-count-up.ts`
- Test: `src/lib/client/use-count-up.test.tsx`

**Interfaces:**

- Produces: `useCountUp(target: number, options?: { from?: number; durationMs?: number; delayMs?: number }): number`: the displayed integer. Under reduced motion it is `target` immediately. Otherwise it starts at `from` (default 0), waits `delayMs` (default 0), then eases to `target` over `durationMs` (default 900).

- [ ] **Step 1: Write the failing test**

`src/lib/client/use-count-up.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCountUp } from "./use-count-up";

function reducedMotion(reduce: boolean) {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: reduce }) });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useCountUp", () => {
  it("shows the target at once under reduced motion", () => {
    reducedMotion(true);
    const { result } = renderHook(() => useCountUp(24, { from: 0 }));
    expect(result.current).toBe(24);
  });

  it("starts at `from`, holds through the delay, then lands exactly on the target", () => {
    reducedMotion(false);
    const { result } = renderHook(() => useCountUp(1024, { from: 1000, durationMs: 800, delayMs: 200 }));
    expect(result.current).toBe(1000);
    act(() => void vi.advanceTimersByTime(150));
    expect(result.current).toBe(1000);
    act(() => void vi.advanceTimersByTime(300));
    expect(result.current).toBeGreaterThan(1000);
    expect(result.current).toBeLessThan(1024);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1024);
  });

  it("counts downwards for a loss", () => {
    reducedMotion(false);
    const { result } = renderHook(() => useCountUp(976, { from: 1000, durationMs: 400 }));
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(976);
  });

  it("does nothing after unmount", () => {
    reducedMotion(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderHook(() => useCountUp(10, { durationMs: 400 }));
    unmount();
    act(() => void vi.advanceTimersByTime(1000));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/lib/client/use-count-up.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/client/use-count-up.ts`:

```ts
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
  const [value, setValue] = useState(() => (reducedMotion() ? target : from));

  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    setValue(from);
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
  }, [target, from, durationMs, delayMs]);

  return value;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/lib/client/use-count-up.test.tsx`
Expected: PASS. If fake timers do not drive `requestAnimationFrame` in this Vitest version, pass `toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"]` to `vi.useFakeTimers` in the test's `beforeEach` (a test-only change).

---

### Task 4: Tier badge, on the leaderboard and stats panel

**Files:**

- Create: `src/components/TierBadge.tsx`
- Modify: `src/components/Leaderboard.tsx` (the rating cell in `Row`)
- Modify: `src/components/StatsPanel.tsx` (after the rating `dd`)
- Modify: `src/app/globals.css` (append a new section at the very end of the file)
- Test: `src/components/TierBadge.test.tsx` (new); add cases to `src/components/Leaderboard.test.tsx` and `src/components/StatsPanel.test.tsx`

**Interfaces:**

- Consumes: `Tier`, `TIER_LABEL`, `tierForRating` (Task 1).
- Produces: `TierBadge({ tier }: { tier: Tier })` renders `<span className="tier-badge" data-tier={tier}>{label}</span>`.

- [ ] **Step 1: Write the failing tests**

`src/components/TierBadge.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TierBadge } from "./TierBadge";

afterEach(cleanup);

describe("TierBadge", () => {
  it("shows the tier's name and exposes it to styling", () => {
    render(<TierBadge tier="gold" />);
    expect(screen.getByText("Gold")).toHaveAttribute("data-tier", "gold");
  });
});
```

In `src/components/Leaderboard.test.tsx`, inside `describe("Leaderboard", …)`, add (rating of `entry(rank)` is `1200 - rank * 10`, so rank 1 is 1190 = Gold, rank 40 is 800 = Bronze):

```tsx
it("shows each player's tier next to their rating", async () => {
  vi.spyOn(api, "leaderboard").mockResolvedValue(board([entry(1, "Zed"), entry(40, "Low")]));
  render(<Leaderboard />);
  const rows = await screen.findAllByRole("row");
  expect(within(rows[1]!).getByText("Gold")).toBeInTheDocument();
  expect(within(rows[2]!).getByText("Bronze")).toBeInTheDocument();
});
```

In `src/components/StatsPanel.test.tsx`, inside `describe("StatsPanel", …)`, add (the fixture rating 1087 is Silver):

```tsx
it("shows the tier for a rated player, and none for an unrated one", () => {
  const { rerender } = render(<StatsPanel stats={stats} />);
  expect(within(screen.getByTestId("stats")).getByText("Silver")).toBeInTheDocument();
  rerender(<StatsPanel stats={{ ...stats, rating: null }} />);
  expect(screen.queryByText("Silver")).toBeNull();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/TierBadge.test.tsx src/components/Leaderboard.test.tsx src/components/StatsPanel.test.tsx`
Expected: FAIL (`TierBadge` missing; no tier text).

- [ ] **Step 3: Implement**

`src/components/TierBadge.tsx`:

```tsx
import { TIER_LABEL, type Tier } from "@/lib/client/tiers";

/** A rank tier (Bronze to Diamond), derived from a rating. Colour comes from `data-tier` in the stylesheet. */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className="tier-badge" data-tier={tier}>
      {TIER_LABEL[tier]}
    </span>
  );
}
```

`src/components/Leaderboard.tsx`: add imports (alphabetical within the groups) `import { tierForRating } from "@/lib/client/tiers";` after the `use-me` import line's neighbours (keep `@/lib/client/*` together, `tiers` sorts before `use-me`), and `import { TierBadge } from "./TierBadge";` after the `Spinner` import. Replace `<td>{entry.rating}</td>` with:

```tsx
<td>
  {entry.rating} <TierBadge tier={tierForRating(entry.rating).tier} />
</td>
```

`src/components/StatsPanel.tsx`: add `import { tierForRating } from "@/lib/client/tiers";` above the existing protocol import, `import { TierBadge } from "./TierBadge";` below it (blank line between the groups), and after the line `{stats.rating && <dd className="hint">#{stats.rating.rank}</dd>}` add:

```tsx
{
  stats.rating && (
    <dd>
      <TierBadge tier={tierForRating(stats.rating.value).tier} />
    </dd>
  );
}
```

Append to the very end of `src/app/globals.css`:

```css
/* ---------------------------------------------------------------- rank tiers */

.tier-badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  line-height: 1.3;
  color: #1b1200;
  background: var(--tier-color);
}
.tier-badge[data-tier="bronze"] {
  --tier-color: #cd7f32;
}
.tier-badge[data-tier="silver"] {
  --tier-color: #b8c2cc;
}
.tier-badge[data-tier="gold"] {
  --tier-color: #ffc93c;
}
.tier-badge[data-tier="platinum"] {
  --tier-color: #6fd6e8;
}
.tier-badge[data-tier="diamond"] {
  --tier-color: #a99bff;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/components/TierBadge.test.tsx src/components/Leaderboard.test.tsx src/components/StatsPanel.test.tsx`
Expected: PASS (the pre-existing cases in both files still pass; if `getByText("1087")` now matches ambiguously, keep the badge in its own `dd` as above, which it is).

---

### Task 5: Podium, award chips and the results screen

**Files:**

- Create: `src/components/Podium.tsx`, `src/components/AwardChips.tsx`
- Modify: `src/components/Results.tsx`
- Modify: `src/app/globals.css` (append after the tier styles from Task 4)
- Test: `src/components/Podium.test.tsx`, `src/components/Results.test.tsx` (both new)

**Interfaces:**

- Consumes: `computeAwards`, `Award`, `AWARD_LABEL` (Task 2); `useCountUp` (Task 3); `ordinal` from `./Scoreboard`; `PlayerView`, `TableView`.
- Produces:
  - `Podium({ players }: { players: readonly PlayerView[] })`: renders nothing for fewer than 2 players. Steps are groups of equal `rank` (1 to 3 steps), numbered `place` 1..n; DOM order is `[2, 1, 3]` for three steps, `[2, 1]` for two. Each step is `data-testid="podium-step-{place}"`. The whole podium is `aria-hidden` (the results table stays the accessible source) with `data-testid="podium"`.
  - `AwardChips({ awards }: { awards: readonly Award[] })`: a `span.award-chip` per award, nothing for an empty list.

- [ ] **Step 1: Write the failing tests**

`src/components/Podium.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlayerView } from "@/lib/protocol";

import { Podium } from "./Podium";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
});
afterEach(cleanup);

const player = (id: string, rank: number, pairs: number): PlayerView => ({
  id,
  name: id.toUpperCase(),
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: pairs,
  pairs,
  streak: 0,
  bestStreak: 0,
  rank,
});

const places = () => [...screen.getByTestId("podium").children].map((el) => el.getAttribute("data-place"));

describe("Podium", () => {
  it("puts first place in the middle of three steps", () => {
    render(<Podium players={[player("a", 1, 6), player("b", 2, 4), player("c", 3, 2), player("d", 4, 1)]} />);
    expect(places()).toEqual(["2", "1", "3"]);
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("A");
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("6");
    expect(screen.queryByText("D")).toBeNull(); // fourth place is not on the podium
  });

  it("shares a step on a tie, and the next group takes the next step", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 1, 5), player("c", 3, 2)]} />);
    expect(places()).toEqual(["2", "1"]);
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("A");
    expect(screen.getByTestId("podium-step-1")).toHaveTextContent("B");
    expect(screen.getByTestId("podium-step-2")).toHaveTextContent("C");
  });

  it("shows two steps for a two-player game", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 2, 3)]} />);
    expect(places()).toEqual(["2", "1"]);
  });

  it("renders nothing for a solo game", () => {
    const { container } = render(<Podium players={[player("a", 1, 8)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is hidden from assistive tech, the results table carries the same facts", () => {
    render(<Podium players={[player("a", 1, 5), player("b", 2, 3)]} />);
    expect(screen.getByTestId("podium")).toHaveAttribute("aria-hidden", "true");
  });
});
```

`src/components/Results.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as meModule from "@/lib/client/use-me";
import * as ratingHook from "@/lib/client/use-rating-change";
import type { PlayerView, TableView } from "@/lib/protocol";

import { Results } from "./Results";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(meModule, "useMe").mockReturnValue({ authEnabled: true, user: null });
  vi.spyOn(ratingHook, "useRatingChange").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const player = (id: string, over: Partial<PlayerView> = {}): PlayerView => ({
  id,
  name: id.toUpperCase(),
  seat: 0,
  status: "active",
  isHost: false,
  isGuest: true,
  moves: 6,
  pairs: 3,
  streak: 0,
  bestStreak: 1,
  rank: 1,
  ...over,
});
const view = (players: PlayerView[], pairs = 8) =>
  ({ code: "ABC234", status: "finished", pairs, players, youId: players[0]!.id }) as unknown as TableView;

describe("Results", () => {
  it("shows the podium and award chips for a versus game", () => {
    render(
      <Results
        view={view([
          player("a", { rank: 1, pairs: 6, moves: 6, bestStreak: 6 }),
          player("b", { rank: 2, pairs: 2, moves: 6 }),
        ])}
      />,
    );
    expect(screen.getByTestId("podium")).toBeInTheDocument();
    const row = within(screen.getByRole("row", { name: /A/ }));
    expect(row.getByText("Longest streak")).toBeInTheDocument();
    expect(row.getByText("Flawless")).toBeInTheDocument();
    expect(row.getByText("Dominant")).toBeInTheDocument();
  });

  it("has no podium and no awards in a solo game", () => {
    render(<Results view={view([player("a", { pairs: 8, moves: 8, bestStreak: 8 })])} />);
    expect(screen.queryByTestId("podium")).toBeNull();
    expect(screen.queryByText("Flawless")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/Podium.test.tsx src/components/Results.test.tsx`
Expected: FAIL (modules missing / no podium).

- [ ] **Step 3: Implement the components**

`src/components/AwardChips.tsx`:

```tsx
import { AWARD_LABEL, type Award } from "@/lib/client/awards";

export function AwardChips({ awards }: { awards: readonly Award[] }) {
  if (awards.length === 0) return null;
  return (
    <span className="award-chips">
      {awards.map((a) => (
        <span key={a} className="award-chip" data-award={a}>
          {AWARD_LABEL[a]}
        </span>
      ))}
    </span>
  );
}
```

`src/components/Podium.tsx`:

```tsx
"use client";

import { useCountUp } from "@/lib/client/use-count-up";
import type { PlayerView } from "@/lib/protocol";

import { ordinal } from "./Scoreboard";

type Step = { place: number; rank: number; players: PlayerView[] };

/** Groups of equal rank, best first, at most three: a tie shares a step and the next group takes the next one. */
function steps(players: readonly PlayerView[]): Step[] {
  const ranked = players.filter((p): p is PlayerView & { rank: number } => p.rank !== null && p.rank <= 3);
  const ranks = [...new Set(ranked.map((p) => p.rank))].sort((a, b) => a - b).slice(0, 3);
  return ranks.map((rank, i) => ({ place: i + 1, rank, players: ranked.filter((p) => p.rank === rank) }));
}

function PodiumStep({ step }: { step: Step }) {
  // Third place rises first, so the winner is revealed last.
  const pairs = useCountUp(step.players[0]!.pairs, { durationMs: 700, delayMs: (3 - step.place) * 300 });
  return (
    <div className="podium-step" data-place={step.place} data-testid={`podium-step-${step.place}`}>
      <span className="podium-names">{step.players.map((p) => p.name).join(" & ")}</span>
      <span className="podium-pairs">{pairs}</span>
      <span className="podium-rank">{ordinal(step.rank)}</span>
    </div>
  );
}

/** Top three of a versus game. Decorative: the results table next to it states the same facts. */
export function Podium({ players }: { players: readonly PlayerView[] }) {
  if (players.length < 2) return null;
  const all = steps(players);
  const order = all.length === 3 ? [all[1]!, all[0]!, all[2]!] : all.length === 2 ? [all[1]!, all[0]!] : all;
  return (
    <div className="podium" data-testid="podium" aria-hidden="true">
      {order.map((step) => (
        <PodiumStep key={step.place} step={step} />
      ))}
    </div>
  );
}
```

Note: `data-place` must be on the element that is a direct child of `.podium` (it is: `PodiumStep` returns the step div), which is what the test reads.

- [ ] **Step 4: Wire `Results`**

In `src/components/Results.tsx`: add `import { computeAwards } from "@/lib/client/awards";` above the protocol import (blank line between it and `import type { TableView }` is not needed; keep the `@/lib` group together, sorted: `awards` before `protocol`), and add `import { AwardChips } from "./AwardChips";` and `import { Podium } from "./Podium";` above the `RatingChange` import. Inside `Results`, after `const youWon = …;` add:

```tsx
const awards = computeAwards(view.players, view.pairs);
```

Render `<Podium players={view.players} />` directly after `<h2>{headline}</h2>`. In the table body, change the player cell to:

```tsx
<td>
  <span className="seat-token" aria-hidden /> {p.name}
  <AwardChips awards={awards[p.id] ?? []} />
</td>
```

- [ ] **Step 5: Styles**

Append to the end of `src/app/globals.css` (after the tier styles):

```css
/* ----------------------------------------------------------- podium and awards */

.podium {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 0.5rem;
  max-width: 34rem;
  margin: 0.5rem 0 1.25rem;
}

.podium-step {
  flex: 1;
  display: grid;
  justify-items: center;
  align-content: end;
  gap: 0.125rem;
  padding: 0.5rem 0.5rem 0.625rem;
  border-radius: var(--radius-control) var(--radius-control) 0 0;
  background: var(--card);
  border: 2px solid var(--line);
  border-bottom: 0;
  text-align: center;
}
.podium-step[data-place="1"] {
  min-height: 7rem;
  border-color: #ffc93c;
}
.podium-step[data-place="2"] {
  min-height: 5.5rem;
}
.podium-step[data-place="3"] {
  min-height: 4.25rem;
}

.podium-names {
  font-weight: 700;
  overflow-wrap: anywhere;
}
.podium-pairs {
  font-size: 1.75rem;
  font-weight: 800;
  line-height: 1;
}
.podium-rank {
  font-size: 0.75rem;
  color: var(--ink-soft);
}

.award-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-left: 0.5rem;
  vertical-align: middle;
}
.award-chip {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 800;
  color: #1b1200;
  background: #ffc93c;
}
.award-chip[data-award="flawless"] {
  background: #46c97a;
}
.award-chip[data-award="dominant"] {
  background: #ff9f43;
}

@media (prefers-reduced-motion: no-preference) {
  .podium-step {
    animation: podium-rise 600ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
  }
  .podium-step[data-place="3"] {
    animation-delay: 0ms;
  }
  .podium-step[data-place="2"] {
    animation-delay: 300ms;
  }
  .podium-step[data-place="1"] {
    animation-delay: 600ms;
  }
  .award-chip {
    animation: award-pop 400ms ease-out 1200ms both;
  }
}

@keyframes podium-rise {
  from {
    opacity: 0;
    transform: translateY(2.5rem) scaleY(0.6);
    transform-origin: bottom;
  }
}

@keyframes award-pop {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run src/components/Podium.test.tsx src/components/Results.test.tsx`
Expected: PASS. If `getByRole("row", { name: /A/ })` matches more than one row, use `screen.getAllByRole("row")[1]` (the first body row is player `a`, because rows are sorted by rank).

---

### Task 6: Rating count-up and promotion

**Files:**

- Modify: `src/components/RatingChange.tsx`
- Modify: `src/components/RatingChange.test.tsx`
- Modify: `src/app/globals.css` (append at the end)

**Interfaces:**

- Consumes: `useCountUp` (Task 3); `tierForRating`, `tierRank`, `TIER_LABEL` (Task 1); `TierBadge` (Task 4); `ConfettiBurst` (existing, `src/components/Confetti.tsx`; props `{ x, y, count, delayMs? }`).
- Produces: `RatingChange({ code, versus })` unchanged signature. New behaviour: the "after" number counts up from `before`; a `TierBadge` for the new tier follows the line; if `tierRank(after) > tierRank(before)` a `<p className="promotion" role="status">Promoted to {Label}!</p>` shows with a confetti burst.

- [ ] **Step 1: Update and extend the tests**

In `src/components/RatingChange.test.tsx`: add `beforeEach` to the vitest import, and add inside the file (above `describe`) a reduced-motion default so the existing synchronous assertions still hold, plus a canvas stub for the burst:

```tsx
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
```

(Keep the existing `afterEach` with `cleanup` and `vi.restoreAllMocks()`; the `beforeEach` spies are restored by it.) The existing three tests keep working unchanged. Add inside `describe("RatingChange", …)`:

```tsx
it("shows the new tier's badge", () => {
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
  render(<RatingChange code="ABC234" versus />);
  expect(screen.getByText("Silver")).toHaveAttribute("data-tier", "silver");
});

it("announces a promotion when the rating crosses into a higher tier", () => {
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1090, after: 1110 });
  render(<RatingChange code="ABC234" versus />);
  expect(screen.getByText("Promoted to Gold!")).toBeInTheDocument();
});

it.each([
  ["a demotion across a boundary", 1110, 1090],
  ["a gain inside one tier", 1000, 1050],
  ["no change", 1000, 1000],
])("does not announce a promotion for %s", (_name, before, after) => {
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(hook, "useRatingChange").mockReturnValue({ before, after });
  render(<RatingChange code="ABC234" versus />);
  expect(screen.queryByText(/Promoted/)).toBeNull();
});

it("starts the number at the old rating, not at zero, when motion is allowed", () => {
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
  vi.spyOn(hook, "useRatingChange").mockReturnValue({ before: 1000, after: 1024 });
  render(<RatingChange code="ABC234" versus />);
  expect(screen.getByRole("status")).toHaveTextContent("Rating 1000 → 1000");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/components/RatingChange.test.tsx`
Expected: FAIL (no badge, no promotion; the last test shows `→ 1024`).

- [ ] **Step 3: Implement**

Replace `src/components/RatingChange.tsx` with:

```tsx
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
```

Also export the type: in `src/lib/client/use-rating-change.ts` the type is already `export type RatingChange = { before: number; after: number }`; the import above aliases it. No change to that file.

Append to the end of `src/app/globals.css`:

```css
/* ------------------------------------------------------------------ promotion */

.promotion {
  margin: 0.25rem 0 0.75rem;
  font-size: 1.125rem;
  font-weight: 800;
}

@media (prefers-reduced-motion: no-preference) {
  .promotion {
    animation: promotion-in 500ms cubic-bezier(0.2, 0.9, 0.3, 1.4) 1000ms both;
  }
}

@keyframes promotion-in {
  from {
    opacity: 0;
    transform: scale(0.6);
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/components/RatingChange.test.tsx`
Expected: PASS (7 cases).

---

### Task 7: Verify and report

- [ ] **Step 1:** Run the `verify` skill (lint → format:check → typecheck → test). Fix failures at the cause; `pnpm exec prettier --write <files>` for formatting only. Do not run E2E, and do not touch the unrelated uncommitted work.
- [ ] **Step 2:** Report what is ready to commit (nothing is committed), which files belong to Phase 2 versus the unrelated cheats work, and that a visual check in a browser (reduced motion on and off) is still pending.
